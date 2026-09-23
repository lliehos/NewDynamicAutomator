using System.Security.Claims;
using Morobot.Contracts.Auth;
using Morobot.Contracts.DataSources;
using Morobot.Contracts.Recordings;
using Morobot.Contracts.Tasks;
using Morobot.Infrastructure.Services;
using Morobot.Web.Hubs;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Controllers.Api;

/// <summary>
/// JSON API for the Chrome extension and portal AJAX — hosted on the Web app (no separate API process).
/// </summary>
[ApiController]
[Authorize]
[Route("api/tasks")]
public class TasksApiController : ControllerBase
{
    private readonly TaskService _tasks;
    private readonly GraphService _graph;
    private readonly EntitlementService _entitlements;
    private readonly EventLogService _events;
    private readonly IHubContext<CanvasHub> _canvasHub;
    private readonly IHubContext<PlayDataHub> _playHub;
    private readonly CatalogLiveService _catalog;
    private readonly PlaySessionTracker _plays;

    public TasksApiController(
        TaskService tasks,
        GraphService graph,
        EntitlementService entitlements,
        EventLogService events,
        IHubContext<CanvasHub> canvasHub,
        IHubContext<PlayDataHub> playHub,
        CatalogLiveService catalog,
        PlaySessionTracker plays)
    {
        _tasks = tasks;
        _graph = graph;
        _entitlements = entitlements;
        _events = events;
        _canvasHub = canvasHub;
        _playHub = playHub;
        _catalog = catalog;
        _plays = plays;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<TaskListItemDto>>> List(CancellationToken ct)
        => Ok(await _tasks.ListForUserAsync(UserId, ct));

    [HttpPost]
    public async Task<ActionResult<TaskListItemDto>> Create([FromBody] CreateTaskRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { message = "عنوان فرآیند لازم است." });

        var entitlements = await _entitlements.ResolveWithCountsAsync(UserId, User, ct);
        try
        {
            var task = await _tasks.CreateAsync(UserId, request, entitlements, ct);
            await _events.LogAsync(
                "Audit", "Task", "TaskCreate",
                $"Created task #{task.Id}: {task.Title}",
                UserId, User.Identity?.Name,
                ipAddress: HttpContext.Connection.RemoteIpAddress?.ToString(),
                path: "/api/tasks",
                ct: ct);
            var dto = new TaskListItemDto
            {
                Id = task.Id,
                Title = task.Title,
                CreatedAtUtc = task.CreatedAtUtc,
                IsOwner = true,
                CanView = true,
                CanEdit = true,
                CanModify = true,
                CanDelete = true,
                CanExecute = true,
                CanChangeDataSource = true,
                CanShare = entitlements.CanShare && !entitlements.IsLocal,
                DesignOrigin = task.DesignOrigin.ToString(),
                OwnerUserName = User.Identity?.Name,
                SharedWithCount = 0
            };
            await _catalog.TaskUpsertedAsync(dto, "created", User.Identity?.Name, ct);
            return Ok(dto);
        }
        catch (InvalidOperationException ex)
        {
            await _events.LogAsync(
                "Warn", "Task", "TaskCreateDenied",
                ex.Message,
                UserId, User.Identity?.Name,
                ipAddress: HttpContext.Connection.RemoteIpAddress?.ToString(),
                ct: ct);
            return BadRequest(new { message = ex.Message, code = "limit" });
        }
    }

    [HttpGet("{id:int}/graph")]
    public async Task<ActionResult<TaskGraphDto>> Graph(int id, CancellationToken ct)
    {
        var graph = await _graph.GetAsync(UserId, id, ct);
        return graph is null ? NotFound() : Ok(graph);
    }

    [HttpPut("{id:int}/graph")]
    public async Task<ActionResult<TaskGraphDto>> SaveGraph(int id, [FromBody] SaveTaskGraphRequest request, CancellationToken ct)
    {
        try
        {
            return Ok(await _graph.SaveAsync(UserId, id, request, ct));
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    /// <summary>Editor freestyle canvas JSON (L2+ server source of truth).</summary>
    [HttpGet("{id:int}/canvas")]
    public async Task<IActionResult> GetCanvas(int id, CancellationToken ct)
    {
        var hit = await _tasks.GetCanvasAsync(UserId, id, ct);
        if (hit is null)
            return NotFound();

        var (json, updatedAt) = hit.Value;
        if (string.IsNullOrWhiteSpace(json))
        {
            return Ok(new
            {
                taskId = id,
                updatedAtUtc = updatedAt,
                nodes = Array.Empty<object>(),
                edges = Array.Empty<object>(),
                dataSources = Array.Empty<object>()
            });
        }

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object)
            {
                var dict = new Dictionary<string, System.Text.Json.JsonElement>();
                foreach (var p in doc.RootElement.EnumerateObject())
                    dict[p.Name] = p.Value.Clone();
                dict["updatedAtUtc"] = System.Text.Json.JsonSerializer.SerializeToElement(updatedAt);
                dict["taskId"] = System.Text.Json.JsonSerializer.SerializeToElement(id);
                return Ok(dict);
            }
        }
        catch { /* fall through */ }

        return Content(json, "application/json");
    }

    [HttpPut("{id:int}/canvas")]
    public async Task<IActionResult> SaveCanvas(int id, [FromBody] System.Text.Json.JsonElement body, CancellationToken ct)
    {
        string? title = null;
        DateTime? baseUpdatedAt = null;
        string? editorSessionId = null;
        var forceSave = false;
        if (body.ValueKind == System.Text.Json.JsonValueKind.Object)
        {
            if (body.TryGetProperty("title", out var t))
                title = t.GetString();
            if (body.TryGetProperty("editorSessionId", out var sid) && sid.ValueKind == System.Text.Json.JsonValueKind.String)
                editorSessionId = sid.GetString();
            if (body.TryGetProperty("forceSave", out var fs)
                && (fs.ValueKind == System.Text.Json.JsonValueKind.True
                    || (fs.ValueKind == System.Text.Json.JsonValueKind.String && fs.GetString() == "true")))
                forceSave = true;
            if (body.TryGetProperty("baseUpdatedAtUtc", out var bu) && bu.ValueKind == System.Text.Json.JsonValueKind.String
                && DateTime.TryParse(bu.GetString(), null, System.Globalization.DateTimeStyles.RoundtripKind, out var parsed))
                baseUpdatedAt = parsed.Kind == DateTimeKind.Unspecified
                    ? DateTime.SpecifyKind(parsed, DateTimeKind.Utc)
                    : parsed.ToUniversalTime();
            else if (body.TryGetProperty("updatedAtUtc", out var u) && u.ValueKind == System.Text.Json.JsonValueKind.String
                && DateTime.TryParse(u.GetString(), null, System.Globalization.DateTimeStyles.RoundtripKind, out var parsed2))
                baseUpdatedAt = parsed2.Kind == DateTimeKind.Unspecified
                    ? DateTime.SpecifyKind(parsed2, DateTimeKind.Utc)
                    : parsed2.ToUniversalTime();
        }

        var taskKey = id.ToString();
        if (_plays.IsPlaying(taskKey) && !forceSave)
        {
            var player = _plays.Get(taskKey);
            return Conflict(new
            {
                message = "Process is currently running.",
                code = "playing",
                playerUserName = player?.UserName
            });
        }

        // Strip concurrency/session meta before persisting canvas JSON.
        var json = StripCanvasMeta(body);
        var (ok, error, newUpdated) = await _tasks.SaveCanvasJsonAsync(UserId, id, json, title, baseUpdatedAt, entitlements: null, ct);
        if (!ok && error == "forbidden") return Forbid();
        if (!ok && error == "notfound") return NotFound();
        if (!ok && error == "conflict")
            return Conflict(new { message = "Process was changed elsewhere.", code = "conflict", updatedAtUtc = newUpdated });
        if (!ok) return BadRequest(new { message = error, code = "limit" });

        if (forceSave && _plays.IsPlaying(taskKey))
        {
            _plays.RequestAbort(taskKey);
            var stopPayload = new
            {
                taskId = id,
                reason = "canvas_changed",
                message = "Play stopped because the process was changed.",
                actorUserName = User.Identity?.Name,
                updatedAtUtc = newUpdated
            };
            await _playHub.Clients.Group(PlayDataHub.TaskGroup(taskKey)).SendAsync("playStopDueToChange", stopPayload, ct);
            await _canvasHub.Clients.Group(CanvasHub.TaskGroup(id)).SendAsync("playStopDueToChange", stopPayload, ct);
            await _events.LogAsync(
                "Warn", "Play", "PlayStoppedByEdit",
                $"Task #{id} play aborted due to canvas save by {User.Identity?.Name}",
                UserId, User.Identity?.Name,
                path: $"/api/tasks/{id}/canvas",
                ct: ct);
        }

        await _canvasHub.Clients.Group(CanvasHub.TaskGroup(id)).SendAsync("canvasChanged", new
        {
            taskId = id,
            updatedAtUtc = newUpdated,
            editorSessionId,
            userId = UserId,
            userName = User.Identity?.Name
        }, ct);

        // Refresh list counters (steps/groups/sources) for live catalogs.
        var list = await _tasks.ListForUserAsync(UserId, ct);
        var item = list.FirstOrDefault(x => x.Id == id);
        if (item != null)
        {
            await _catalog.TaskUpsertedAsync(item, "updated", User.Identity?.Name, ct);
            await _catalog.SourceChangedAsync(id, new
            {
                taskId = id,
                taskTitle = item.Title,
                dataSourceCount = item.DataSourceCount
            }, "updated", User.Identity?.Name, ct);
        }

        return Ok(new { ok = true, updatedAtUtc = newUpdated });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        if (!await _tasks.CanDeleteAsync(UserId, id, ct))
            return Forbid();
        var ok = await _tasks.DeleteAsync(id, ct);
        if (ok)
        {
            await _catalog.TaskDeletedAsync(id, User.Identity?.Name, ct);
            await _events.LogAsync(
                "Audit", "Task", "TaskDelete",
                $"Deleted task #{id}",
                UserId, User.Identity?.Name,
                path: $"/api/tasks/{id}",
                ct: ct);
        }
        return ok ? NoContent() : NotFound();
    }

    private static string StripCanvasMeta(System.Text.Json.JsonElement body)
    {
        if (body.ValueKind != System.Text.Json.JsonValueKind.Object)
            return body.GetRawText();
        using var stream = new System.IO.MemoryStream();
        using (var writer = new System.Text.Json.Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var prop in body.EnumerateObject())
            {
                if (prop.NameEquals("baseUpdatedAtUtc")
                    || prop.NameEquals("editorSessionId")
                    || prop.NameEquals("forceSave")
                    || prop.NameEquals("updatedAtUtc"))
                    continue;
                prop.WriteTo(writer);
            }
            writer.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }
}

[ApiController]
[Authorize]
[Route("api/recordings")]
public class RecordingsApiController : ControllerBase
{
    private readonly RecordingService _recordings;

    public RecordingsApiController(RecordingService recordings) => _recordings = recordings;

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    public async Task<ActionResult<SaveRecordingResponse>> Save([FromBody] SaveRecordingRequest request, CancellationToken ct)
    {
        if (request.Actions.Count == 0)
            return BadRequest(new { message = "هیچ اکشنی برای ذخیره نیست." });

        var entitlements = EntitlementService.FromClaims(User);
        if (!entitlements.CanRecord)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Recording requires Pro plan.", code = "upgrade" });

        try
        {
            return Ok(await _recordings.SaveAsync(UserId, request, ct));
        }
        catch (UnauthorizedAccessException ex)
        {
            return Forbid(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message, code = "limit" });
        }
    }
}

[ApiController]
[Authorize]
[Route("api/tasks/{taskId:int}/datasources")]
public class TaskDataSourcesApiController : ControllerBase
{
    private readonly DataSourceService _sources;
    private readonly EntitlementService _entitlements;

    public TaskDataSourcesApiController(DataSourceService sources, EntitlementService entitlements)
    {
        _sources = sources;
        _entitlements = entitlements;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<DataSourceListItemDto>>> List(int taskId, CancellationToken ct)
        => Ok(await _sources.ListForTaskAsync(UserId, taskId, ct));

    [HttpPost("upload")]
    [RequestSizeLimit(20_000_000)]
    public async Task<ActionResult<UploadDataSourceResponse>> Upload(
        int taskId,
        IFormFile file,
        [FromForm] string? title,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "فایل اکسل لازم است." });

        var name = file.FileName ?? "";
        if (!name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
            && !name.EndsWith(".xlsm", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "فقط فایل .xlsx پشتیبانی می‌شود." });

        var entitlements = await _entitlements.ResolveWithCountsAsync(UserId, User, ct);
        try
        {
            if (!entitlements.IsLocal)
                await _entitlements.EnsureCanCreateDataSourceAsync(UserId, entitlements, ct);

            await using var stream = file.OpenReadStream();
            var result = await _sources.UploadExcelAsync(
                UserId, taskId, title ?? Path.GetFileNameWithoutExtension(name), stream, ct);
            return Ok(result);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message, code = "limit" });
        }
    }
}

[ApiController]
[Authorize]
[Route("api/datasources")]
public class DataSourcesApiController : ControllerBase
{
    private readonly DataSourceService _sources;

    public DataSourcesApiController(DataSourceService sources) => _sources = sources;

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<DataSourceDetailDto>> Get(int id, CancellationToken ct)
    {
        var dto = await _sources.GetAsync(UserId, id, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        try
        {
            var ok = await _sources.DeleteAsync(UserId, id, ct);
            return ok ? NoContent() : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }
}
