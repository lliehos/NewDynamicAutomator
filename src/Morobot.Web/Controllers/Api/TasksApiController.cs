using System.Security.Claims;
using Morobot.Contracts.Auth;
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
/// HTTP paths stay under /api/tasks for client compatibility; domain entity is Process.
/// </summary>
[ApiController]
[Authorize]
[Route("api/tasks")]
public class TasksApiController : ControllerBase
{
    private readonly TaskService _tasks;
    private readonly EntitlementService _entitlements;
    private readonly EventLogService _events;
    private readonly IHubContext<CanvasHub> _canvasHub;
    private readonly IHubContext<PlayDataHub> _playHub;
    private readonly CatalogLiveService _catalog;
    private readonly PlaySessionTracker _plays;

    public TasksApiController(
        TaskService tasks,
        EntitlementService entitlements,
        EventLogService events,
        IHubContext<CanvasHub> canvasHub,
        IHubContext<PlayDataHub> playHub,
        CatalogLiveService catalog,
        PlaySessionTracker plays)
    {
        _tasks = tasks;
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

    /// <summary>Legacy alias — returns the same GraphJson payload as /canvas.</summary>
    [HttpGet("{id:int}/graph")]
    public Task<IActionResult> Graph(int id, CancellationToken ct) => GetCanvas(id, ct);

    /// <summary>Legacy write path retired — use PUT /canvas. Returns 410.</summary>
    [HttpPut("{id:int}/graph")]
    public IActionResult SaveGraph(int id) =>
        StatusCode(StatusCodes.Status410Gone, new
        {
            message = "Relational graph API retired. Use PUT /api/tasks/{id}/canvas.",
            code = "gone"
        });

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
        var recipients = await _catalog.ResolveAccessUserIdsAsync(id, ct);
        var ok = await _tasks.DeleteAsync(id, ct);
        if (ok)
        {
            await _catalog.TaskDeletedAsync(id, recipients, User.Identity?.Name, ct);
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

/// <summary>Relational datasources API retired — sources live in GraphJson via /canvas.</summary>
[ApiController]
[Authorize]
[Route("api/tasks/{taskId:int}/datasources")]
public class TaskDataSourcesApiController : ControllerBase
{
    [HttpGet]
    public IActionResult List(int taskId) =>
        StatusCode(StatusCodes.Status410Gone, new
        {
            message = "Relational datasources retired. Use process canvas dataSources.",
            code = "gone"
        });

    [HttpPost("upload")]
    public IActionResult Upload(int taskId) =>
        StatusCode(StatusCodes.Status410Gone, new
        {
            message = "Upload into canvas via editor ParseExcel + PUT /canvas.",
            code = "gone"
        });
}

[ApiController]
[Authorize]
[Route("api/datasources")]
public class DataSourcesApiController : ControllerBase
{
    [HttpGet("{id:int}")]
    public IActionResult Get(int id) =>
        StatusCode(StatusCodes.Status410Gone, new { message = "Relational datasources retired.", code = "gone" });

    [HttpDelete("{id:int}")]
    public IActionResult Delete(int id) =>
        StatusCode(StatusCodes.Status410Gone, new { message = "Relational datasources retired.", code = "gone" });
}
