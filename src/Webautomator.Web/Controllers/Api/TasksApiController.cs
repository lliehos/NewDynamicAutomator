using System.Security.Claims;
using Webautomator.Contracts.Auth;
using Webautomator.Contracts.Recordings;
using Webautomator.Contracts.Tasks;
using Webautomator.Domain.Entities;
using Webautomator.Infrastructure.Services;
using Webautomator.Web.Hubs;
using Webautomator.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace Webautomator.Web.Controllers.Api;

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
    private readonly TemplateService _templates;
    private readonly EntitlementService _entitlements;
    private readonly EventLogService _events;
    private readonly IHubContext<CanvasHub> _canvasHub;
    private readonly IHubContext<PlayDataHub> _playHub;
    private readonly CatalogLiveService _catalog;
    private readonly PlaySessionTracker _plays;
    private readonly DataSourceService _sources;

    public TasksApiController(
        TaskService tasks,
        TemplateService templates,
        EntitlementService entitlements,
        EventLogService events,
        IHubContext<CanvasHub> canvasHub,
        IHubContext<PlayDataHub> playHub,
        CatalogLiveService catalog,
        PlaySessionTracker plays,
        DataSourceService sources)
    {
        _tasks = tasks;
        _templates = templates;
        _entitlements = entitlements;
        _events = events;
        _canvasHub = canvasHub;
        _playHub = playHub;
        _catalog = catalog;
        _plays = plays;
        _sources = sources;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<TaskListItemDto>>> List(CancellationToken ct)
        => Ok(await _tasks.ListForUserAsync(UserId, ct));

    /// <summary>Recorded runs of one process, newest first, for the processes list's history button.</summary>
    [HttpGet("{id:int}/runs")]
    public async Task<ActionResult<List<TaskRunEntry>>> Runs(int id, CancellationToken ct)
    {
        // Authorisation goes through the normal list query: if the process is not visible to
        // this user it will not be in their list, and the history is then simply empty.
        var list = await _tasks.ListForUserAsync(UserId, ct);
        if (list.All(t => t.Id != id)) return NotFound();
        return Ok(await _tasks.ListRunsAsync(id, ct: ct));
    }

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
                UpdatedAtUtc = task.UpdatedAtUtc,
                LastEditorUserName = User.Identity?.Name,
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

    /// <summary>
    /// Copy a process on the server, including its graph and its linked data sources.
    /// </summary>
    /// <remarks>
    /// POST, not GET: it creates a record. The new process is returned in the same shape as the
    /// list endpoint so the caller can insert it into the list without a second round trip.
    /// </remarks>
    [HttpPost("{id:int}/clone")]
    public async Task<ActionResult<TaskListItemDto>> Clone(int id, CancellationToken ct)
    {
        var entitlements = await _entitlements.ResolveWithCountsAsync(UserId, User, ct);
        Process? copy;
        try
        {
            copy = await _tasks.CloneAsync(UserId, id, newTitle: null, ct);
        }
        catch (InvalidOperationException ex)
        {
            // The copy is a new process, so it has to pass the same process-limit check as any
            // other creation; a caller at their ceiling must get a clear refusal, not a 500.
            await _events.LogAsync(
                "Warn", "Task", "TaskCloneDenied",
                ex.Message, UserId, User.Identity?.Name,
                ipAddress: HttpContext.Connection.RemoteIpAddress?.ToString(),
                path: $"/api/tasks/{id}/clone",
                ct: ct);
            return BadRequest(new { message = ex.Message, code = "limit" });
        }

        if (copy is null) return NotFound();

        await _events.LogAsync(
            "Audit", "Task", "TaskClone",
            $"Cloned task #{id} into #{copy.Id}: {copy.Title}",
            UserId, User.Identity?.Name,
            ipAddress: HttpContext.Connection.RemoteIpAddress?.ToString(),
            path: $"/api/tasks/{id}/clone",
            ct: ct);

        // Read the new row back through the list query so the returned permissions, counts and
        // last-run fields are the same ones the list page would show for it.
        var list = await _tasks.ListForUserAsync(UserId, ct);
        var dto = list.FirstOrDefault(t => t.Id == copy.Id);
        if (dto is not null)
            await _catalog.TaskUpsertedAsync(dto, "created", User.Identity?.Name, ct);

        return Ok(dto ?? new TaskListItemDto
        {
            Id = copy.Id,
            Title = copy.Title,
            CreatedAtUtc = copy.CreatedAtUtc,
            UpdatedAtUtc = copy.UpdatedAtUtc,
            IsOwner = true,
            CanView = true,
            CanEdit = true,
            CanModify = true,
            CanDelete = true,
            CanExecute = true,
            CanChangeDataSource = true,
            CanShare = entitlements.CanShare && !entitlements.IsLocal,
            DesignOrigin = copy.DesignOrigin.ToString(),
            OwnerUserName = User.Identity?.Name
        });
    }

    [HttpPut("{id:int}/title")]
    public async Task<IActionResult> UpdateTitle(int id, [FromBody] UpdateTaskTitleRequest request, CancellationToken ct)
    {
        var (ok, error, newUpdated) = await _tasks.UpdateTitleAsync(UserId, id, request.Title, ct);
        if (!ok && error == "forbidden") return Forbid();
        if (!ok && error == "notfound") return NotFound();
        if (!ok) return BadRequest(new { message = error });

        await _canvasHub.Clients.Group(CanvasHub.TaskGroup(id)).SendAsync("canvasChanged", new
        {
            taskId = id,
            updatedAtUtc = newUpdated,
            editorSessionId = request.EditorSessionId,
            userId = UserId,
            userName = User.Identity?.Name,
            title = request.Title?.Trim()
        }, ct);

        var list = await _tasks.ListForUserAsync(UserId, ct);
        var item = list.FirstOrDefault(x => x.Id == id);
        if (item != null)
            await _catalog.TaskUpsertedAsync(item, "updated", User.Identity?.Name, ct);

        return Ok(new { ok = true, updatedAtUtc = newUpdated, title = item?.Title ?? request.Title?.Trim() });
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

    /// <summary>
    /// Push the results of a run that happened on the user's own machine.
    /// </summary>
    /// <remarks>
    /// A local run is off the server's books by design, so this is the only moment the two copies
    /// meet. The client has already warned that the server copy may have moved on or that values the
    /// server never saw may be replaced; the server's job is to apply the write and report what it
    /// did, not to second-guess the decision. Only the sources the client actually touched are sent,
    /// and each cell is written through the normal per-cell path so revision/concurrency semantics
    /// hold here exactly as they do for an online write.
    /// </remarks>
    [HttpPost("{id:int}/sync-local-run")]
    public async Task<IActionResult> SyncLocalRun(int id, [FromBody] SyncLocalRunRequest? body, CancellationToken ct)
    {
        var taskKey = id.ToString();
        // A local run is never registered, so a live session here means someone else is running it
        // right now and writing into it would race them. Refuse rather than interleave.
        if (_plays.IsPlaying(taskKey))
        {
            var player = _plays.Get(taskKey);
            return Conflict(new
            {
                message = "Process is currently running; sync after it finishes.",
                code = "playing",
                playerUserName = player?.UserName
            });
        }

        // GetCanvasAsync applies the same ownership/share check every other task read uses, so a
        // user cannot sync into a process they cannot see.
        var canvas = await _tasks.GetCanvasAsync(UserId, id, ct);
        if (canvas is null) return NotFound();

        var cells = body?.Cells ?? new List<SyncLocalRunCellDto>();
        var applied = 0;
        var skipped = 0;
        foreach (var cell in cells)
        {
            if (cell.DataSourceId <= 0) { skipped++; continue; }
            var res = await _sources.PatchCellAsync(UserId, cell.DataSourceId, new Webautomator.Contracts.DataSources.PatchDataSourceCellRequest
            {
                RowIndex = cell.RowIndex,
                ColumnKey = cell.ColumnKey,
                CellValue = cell.CellValue ?? "",
                // Let the service resolve the current revision itself: the local run's revision is
                // from another machine and would only produce spurious conflicts.
                ExpectedCellRevision = null,
                InsertMode = "auto"
            }, ct);
            if (res?.Ok == true) applied++; else skipped++;
        }

        // The server now holds this run's values for these sources, so the "there is a newer copy on
        // the client" flag has served its purpose and is cleared — even for cells that were skipped,
        // because the user has made the sync decision and a badge that never clears would train them
        // to ignore it.
        await _sources.ClearNeedsSyncAsync(cells.Select(c => c.DataSourceId), ct);

        await _events.LogAsync("Info", "Play", "LocalRunSynced",
            $"Local run results synced ({applied} cell(s))",
            UserId, User.Identity?.Name,
            System.Text.Json.JsonSerializer.Serialize(new { taskId = id, applied, skipped }),
            path: HttpContext.Request.Path,
            ipAddress: HttpContext.Connection.RemoteIpAddress?.ToString(),
            ct: ct);

        await _catalog.BroadcastProcessListItemAsync(id, "data_updated", User.Identity?.Name, ct);
        await _canvasHub.Clients.Group(CanvasHub.TaskGroup(id)).SendAsync("canvasChanged", new
        {
            taskId = id,
            userId = UserId,
            userName = User.Identity?.Name,
            reason = "local_run_synced"
        }, ct);

        return Ok(new { ok = true, applied, skipped });
    }

    /// <summary>
    /// Report which sources a local run changed, before the values are synced.
    /// </summary>
    /// <remarks>
    /// The server never sees a local run while it happens, so the client is the only one that knows
    /// a source diverged. This is how that knowledge reaches the panel: the flagged source then wears
    /// the sync icon, and <see cref="SyncLocalRun"/> clears it when the values actually arrive.
    /// </remarks>
    [HttpPost("{id:int}/local-run-changes")]
    public async Task<IActionResult> ReportLocalRunChanges(int id, [FromBody] LocalRunChangesRequest? body, CancellationToken ct)
    {
        // Same visibility rule as every other task action: only someone who can see the process may
        // report against it.
        var canvas = await _tasks.GetCanvasAsync(UserId, id, ct);
        if (canvas is null) return NotFound();

        var marked = await _sources.MarkNeedsSyncAsync(UserId, body?.DataSourceIds ?? new List<int>(), ct);
        if (marked > 0)
            await _catalog.BroadcastProcessListItemAsync(id, "data_updated", User.Identity?.Name, ct);
        return Ok(new { ok = true, marked });
    }

    /// <summary>
    /// Persist a process's step gap and highlight colour, onto its start node.
    /// </summary>
    /// <remarks>
    /// These are properties of the PROCESS, not of one client: the panel editor reads the same two
    /// fields, so a desktop-only copy would make one process pace itself differently depending on who
    /// started it. The write patches only those two keys, so saving a setting can never clobber an
    /// edit someone made in the editor meanwhile.
    /// </remarks>
    [HttpPost("{id:int}/run-settings")]
    public async Task<IActionResult> SaveRunSettings(int id, [FromBody] RunSettingsRequest? body, CancellationToken ct)
    {
        var taskKey = id.ToString();
        // A run owns its settings while it is going: changing the gap mid-run would alter the pacing
        // the already-taken steps were started under.
        if (_plays.IsPlaying(taskKey))
            return Conflict(new { message = "Process is currently running.", code = "playing" });

        var canvas = await _tasks.GetCanvasAsync(UserId, id, ct);
        if (canvas is null) return NotFound();

        // Reject a non-#RRGGBB colour rather than storing it: both clients only understand that form,
        // so accepting anything else would silently stop the outline from drawing.
        var color = NormalizeHighlightColor(body?.HighlightColor);
        var delay = Math.Clamp(body?.StepDelayMs ?? 0, 0, 60000);

        var ok = await _tasks.PatchRunSettingsAsync(UserId, id, delay, color, ct);
        if (!ok) return NotFound();

        await _catalog.BroadcastProcessListItemAsync(id, "data_updated", User.Identity?.Name, ct);
        await _canvasHub.Clients.Group(CanvasHub.TaskGroup(id)).SendAsync("canvasChanged", new
        {
            taskId = id,
            userId = UserId,
            userName = User.Identity?.Name,
            reason = "run_settings_changed"
        }, ct);

        return Ok(new { ok = true, id, stepDelayMs = delay, highlightColor = color });
    }

    private static string? NormalizeHighlightColor(string? raw)
    {
        var s = (raw ?? "").Trim();
        if (s.Length == 0) return null;
        if (!s.StartsWith('#')) s = "#" + s;
        if (s.Length != 7) return null;
        for (var i = 1; i < 7; i++)
        {
            if (!Uri.IsHexDigit(s[i])) return null;
        }
        return s.ToUpperInvariant();
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

        // Cascade half two: if this process is the source of a template, publish its new graph on to
        // the template and from there to every child. The children keep their own start-node
        // parameters (data source, border colour, repeat mode/range) — that is what makes them
        // useful — while everything else follows the mother.
        //
        // Failures here must not lose the mother's save, so the cascade is best-effort: the mother's
        // own graph is already committed by SaveCanvasJsonAsync above and its version is synced
        // inside the call.
        var (cascadedToTemplate, pushedToChildren) = await _templates.PushMotherGraphToTemplateAsync(id, json, UserId, ct);
        if (cascadedToTemplate)
        {
            await _events.LogAsync(
                "Audit", "Template", "TemplateCascade",
                $"Mother #{id} saved; template refreshed and pushed to {pushedToChildren} child(ren)",
                UserId, User.Identity?.Name,
                path: $"/api/tasks/{id}/canvas",
                ct: ct);
        }

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

    /// <summary>
    /// What deleting this process would also remove, so the UI can warn before it does.
    /// </summary>
    /// <remarks>
    /// A mother carries a template and that template carries the children, none of which is visible
    /// from the row itself. Asking first is the only way the confirmation can state the real cost.
    /// </remarks>
    [HttpGet("{id:int}/delete-impact")]
    public async Task<IActionResult> DeleteImpact(int id, CancellationToken ct)
    {
        if (!await _tasks.CanDeleteAsync(UserId, id, ct)) return Forbid();
        var (isMother, templateId, templateTitle, childCount) = await _tasks.GetDeleteImpactAsync(id, ct);
        return Ok(new { isMother, templateId, templateTitle, childCount });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        if (!await _tasks.CanDeleteAsync(UserId, id, ct))
            return Forbid();
        var recipients = await _catalog.ResolveAccessUserIdsAsync(id, ct);

        // Read the impact BEFORE the delete: afterwards the template is gone and there is nothing
        // left to describe, but the log and the response still need the real numbers.
        var (isMother, templateId, templateTitle, childCount) = await _tasks.GetDeleteImpactAsync(id, ct);

        var detached = await _tasks.DeleteAsync(id, ct);
        var ok = detached >= 0;
        if (ok)
        {
            await _catalog.TaskDeletedAsync(id, recipients, User.Identity?.Name, ct);
            await _events.LogAsync(
                "Audit", "Task", "TaskDelete",
                isMother
                    ? $"Deleted task #{id} (mother); deleted template #{templateId} and detached {detached} child(ren)"
                    : $"Deleted task #{id}",
                UserId, User.Identity?.Name,
                path: $"/api/tasks/{id}",
                ct: ct);

            // The detached children changed, so anything watching the list has to re-read them —
            // each lost its template chip the moment the template went away.
            if (detached > 0)
            {
                foreach (var row in (await _tasks.ListForUserAsync(UserId, ct))
                    .Where(r => r.TemplateId is null && !r.IsTemplateSource))
                {
                    await _catalog.TaskUpsertedAsync(row, "updated", User.Identity?.Name, ct);
                }
            }

            return Ok(new
            {
                ok = true,
                deletedTemplateId = isMother ? templateId : (int?)null,
                deletedTemplateTitle = isMother ? templateTitle : null,
                detachedProcesses = detached
            });
        }
        return NotFound();
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

/// <summary>Attach / detach library sources to a process (detach does not delete the library row).</summary>
[ApiController]
[Authorize]
[Route("api/tasks/{taskId:int}/datasources")]
public class TaskDataSourcesApiController : ControllerBase
{
    private readonly DataSourceService _sources;
    private readonly CatalogLiveService _catalog;

    public TaskDataSourcesApiController(DataSourceService sources, CatalogLiveService catalog)
    {
        _sources = sources;
        _catalog = catalog;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost("{dataSourceId:int}/attach")]
    public async Task<IActionResult> Attach(int taskId, int dataSourceId, [FromQuery] bool setDefault = false, CancellationToken ct = default)
    {
        var (ok, error) = await _sources.AttachAsync(UserId, taskId, dataSourceId, setDefault, ct);
        if (!ok)
            return error switch
            {
                "forbidden" => Forbid(),
                "sourcenotfound" or "notfound" => NotFound(),
                _ => BadRequest(new { message = error })
            };
        await _catalog.SourceChangedAsync(taskId, new { id = dataSourceId }, "attached", User.Identity?.Name, ct);
        return Ok(new { ok = true });
    }

    [HttpDelete("{dataSourceId:int}")]
    public async Task<IActionResult> Detach(int taskId, int dataSourceId, CancellationToken ct = default)
    {
        var (ok, error) = await _sources.DetachAsync(UserId, taskId, dataSourceId, ct);
        if (!ok)
            return error == "forbidden" ? Forbid() : BadRequest(new { message = error });
        await _catalog.SourceChangedAsync(taskId, new { id = dataSourceId }, "detached", User.Identity?.Name, ct);
        return Ok(new { ok = true });
    }
}

[ApiController]
[Authorize]
[Route("api/datasources")]
public class DataSourcesApiController : ControllerBase
{
    private readonly DataSourceService _sources;
    private readonly EntitlementService _entitlements;
    private readonly CatalogLiveService _catalog;
    private readonly IHubContext<CanvasHub> _canvasHub;

    public DataSourcesApiController(
        DataSourceService sources,
        EntitlementService entitlements,
        CatalogLiveService catalog,
        IHubContext<CanvasHub> canvasHub)
    {
        _sources = sources;
        _entitlements = entitlements;
        _catalog = catalog;
        _canvasHub = canvasHub;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<Webautomator.Contracts.DataSources.DataSourceListItemDto>>> List(CancellationToken ct)
        => Ok(await _sources.ListForUserAsync(UserId, ct));

    [HttpGet("{id:int}/meta")]
    public async Task<IActionResult> GetMeta(int id, CancellationToken ct)
    {
        // Derived so counts stay correct now that cell writes no longer update the parent row.
        var dto = await _sources.GetMetaDerivedAsync(UserId, id, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpGet("{id:int}/cells")]
    public async Task<IActionResult> GetCell(
        int id, [FromQuery] int rowIndex, [FromQuery] string columnKey, CancellationToken ct)
    {
        var dto = await _sources.GetCellAsync(UserId, id, rowIndex, columnKey, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpGet("{id:int}/rows/{rowIndex:int}")]
    public async Task<IActionResult> GetRow(int id, int rowIndex, CancellationToken ct)
    {
        var dto = await _sources.GetRowAsync(UserId, id, rowIndex, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    /// <summary>
    /// Bulk row page for table views — replaces the per-row request loop (N round trips → 1).
    /// Pass <paramref name="keys"/> to pull only the columns being rendered.
    /// </summary>
    [HttpGet("{id:int}/rows")]
    public async Task<IActionResult> GetRows(
        int id,
        [FromQuery] int from = 0,
        [FromQuery] int count = 500,
        [FromQuery] string? keys = null,
        CancellationToken ct = default)
    {
        var keyList = string.IsNullOrWhiteSpace(keys)
            ? null
            : keys.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var dto = await _sources.GetRowsPageAsync(UserId, id, from, count, keyList, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    /// <summary>Grid context menu — append/insert a column. Safe for running processes (nothing binds to it yet).</summary>
    [HttpPost("{id:int}/columns")]
    public async Task<IActionResult> AddColumn(
        int id, [FromBody] Webautomator.Contracts.DataSources.AddDataSourceColumnRequest req, CancellationToken ct)
    {
        var result = await _sources.AddColumnAsync(UserId, id, req ?? new(), ct);
        if (!result.Ok)
            return result.Code switch
            {
                "notfound" => NotFound(),
                "forbidden" => Forbid(),
                _ => BadRequest(result)
            };
        await BroadcastSourceShapeAsync(id, result, "column_added", ct);
        return Ok(result);
    }

    /// <summary>
    /// Grid header edit — rename a column. Every linked process whose nodes bind the column is
    /// re-pointed at the new name in the same operation, so nothing keeps reading the old key.
    /// </summary>
    [HttpPatch("{id:int}/columns")]
    public async Task<IActionResult> RenameColumn(
        int id, [FromBody] Webautomator.Contracts.DataSources.RenameDataSourceColumnRequest req, CancellationToken ct)
    {
        var result = await _sources.RenameColumnAsync(UserId, id, req ?? new(), ct);
        if (!result.Ok)
            return result.Code switch
            {
                "forbidden" => Forbid(),
                "column-not-found" => NotFound(result),
                _ => BadRequest(result)
            };
        await BroadcastSourceShapeAsync(id, result, "column_renamed", ct);
        return Ok(result);
    }

    /// <summary>
    /// Grid context menu — delete a column (and every cell in it). Bindings that still name the
    /// column are left in place on purpose: the affected-process count comes back so the caller can
    /// warn, and the editor validation points at each node that must pick another column.
    /// </summary>
    [HttpDelete("{id:int}/columns/{key}")]
    public async Task<IActionResult> DeleteColumn(int id, string key, CancellationToken ct)
    {
        var result = await _sources.DeleteColumnAsync(UserId, id, key, ct);
        if (!result.Ok)
            return result.Code switch
            {
                "forbidden" => Forbid(),
                "column-not-found" => NotFound(result),
                _ => BadRequest(result)
            };
        await BroadcastSourceShapeAsync(id, result, "column_deleted", ct);
        return Ok(result);
    }

    /// <summary>Grid context menu — append/insert blank row(s).</summary>
    [HttpPost("{id:int}/rows/add")]
    public async Task<IActionResult> AddRows(
        int id, [FromBody] Webautomator.Contracts.DataSources.AddDataSourceRowRequest req, CancellationToken ct)
    {
        var result = await _sources.AddRowsAsync(UserId, id, req ?? new(), ct);
        if (!result.Ok)
            return result.Code switch
            {
                "notfound" => NotFound(),
                "forbidden" => Forbid(),
                _ => BadRequest(result)
            };
        await BroadcastSourceShapeAsync(id, result, "row_added", ct);
        return Ok(result);
    }

    /// <summary>Remove one row from a source (used by the grid and the DeleteRow action).</summary>
    [HttpDelete("{id:int}/rows/{rowIndex:int}")]
    public async Task<IActionResult> DeleteRow(int id, int rowIndex, CancellationToken ct)
    {
        var result = await _sources.DeleteRowAsync(UserId, id, rowIndex, ct);
        if (!result.Ok)
            return result.Code switch
            {
                "notfound" => NotFound(),
                "forbidden" => Forbid(),
                "row-not-found" => NotFound(result),
                _ => BadRequest(result)
            };
        await BroadcastSourceShapeAsync(id, result, "row_deleted", ct);
        return Ok(result);
    }

    /// <summary>
    /// Empty the grid but keep the columns — the "clear data" button on the source viewer. Columns
    /// stay so every node binding that names one keeps working; only the rows are gone.
    /// </summary>
    [HttpDelete("{id:int}/rows")]
    public async Task<IActionResult> ClearRows(int id, CancellationToken ct)
    {
        var result = await _sources.ClearRowsAsync(UserId, id, ct);
        if (!result.Ok)
            return result.Code switch
            {
                "notfound" => NotFound(),
                "forbidden" => Forbid(),
                _ => BadRequest(result)
            };
        await BroadcastSourceShapeAsync(id, result, "rows_cleared", ct);
        return Ok(result);
    }

    /// <summary>Tell clients + connected editors that a source's shape (columns/rows) changed.</summary>
    private async Task BroadcastSourceShapeAsync(
        int dataSourceId, Webautomator.Contracts.DataSources.DataSourceStructureResponse result, string reason, CancellationToken ct)
    {
        await _catalog.LibrarySourceChangedAsync(new
        {
            id = result.DataSourceId,
            columnCount = result.ColumnCount,
            rowCount = result.RowCount,
            dataRevision = result.DataRevision,
            addedColumnKey = result.AddedColumnKey,
            renamedFromKey = result.RenamedFromKey,
            renamedColumnKey = result.RenamedColumnKey,
            deletedColumnKey = result.DeletedColumnKey
        }, reason, User.Identity?.Name, UserId, ct);

        var linked = await _sources.GetLinkedProcessIdsAsync(dataSourceId, ct);
        foreach (var processId in linked)
        {
            await _catalog.SourceChangedAsync(processId, new
            {
                id = result.DataSourceId,
                dataRevision = result.DataRevision,
                addedColumnKey = result.AddedColumnKey,
                renamedFromKey = result.RenamedFromKey,
                renamedColumnKey = result.RenamedColumnKey,
                deletedColumnKey = result.DeletedColumnKey
            }, reason, User.Identity?.Name, ct);
            await _canvasHub.Clients.Group(CanvasHub.TaskGroup(processId)).SendAsync("canvasChanged", new
            {
                taskId = processId,
                dataSourceId = result.DataSourceId,
                reason,
                userId = UserId,
                userName = User.Identity?.Name
            }, ct);
        }
    }

    [HttpPatch("{id:int}/cells")]
    public async Task<IActionResult> PatchCell(
        int id, [FromBody] Webautomator.Contracts.DataSources.PatchDataSourceCellRequest req, CancellationToken ct)
    {
        var result = await _sources.PatchCellAsync(UserId, id, req, ct);
        if (!result.Ok && result.Message == "forbidden") return Forbid();
        // Include the ceiling case explicitly: it is a refusal to grow the source, which the client
        // must be able to tell apart from a plain validation failure so it can stop retrying and
        // show the cap. Answering 400 here (falling through to the last branch) made that
        // indistinguishable for a caller that only looks at the status code.
        if (!result.Ok && (result.Conflict || result.Code == SourceLimitExceededException.Code))
            return Conflict(result);
        if (!result.Ok) return BadRequest(result);

        // Everywhere the source is listed has to hear about a cell write, not just the page that
        // made it. Read the source's current shape so listeners get a full row to upsert with:
        // sending only {id, dataRevision} left the admin list unable to render anything but the id.
        var meta = await _sources.GetMetaAsync(UserId, id, ct);
        await _catalog.LibrarySourceChangedAsync(new
        {
            id,
            title = meta?.Title,
            columnCount = meta?.ColumnCount,
            rowCount = meta?.RowCount,
            dataRevision = result.DataRevision,
            // The stamp of the value just written, so a listener can refresh a tooltip without
            // re-reading the row.
            rowIndex = req.RowIndex,
            columnKey = req.ColumnKey,
            cellValue = result.CellValue,
            editorUserId = result.LastEditorUserId,
            editorUserName = result.LastEditorUserName,
            updatedAtUtc = result.UpdatedAtUtc
        }, "cell_patched", User.Identity?.Name, UserId, ct);

        var linked = await _sources.GetLinkedProcessIdsAsync(id, ct);
        foreach (var processId in linked)
        {
            // The process-scoped event is what the processes page viewer listens to, so a linked
            // process's open grid is repainted from the server instead of going stale.
            await _catalog.SourceChangedAsync(processId, new
            {
                id,
                columnCount = meta?.ColumnCount,
                rowCount = meta?.RowCount,
                dataRevision = result.DataRevision,
                rowIndex = req.RowIndex,
                columnKey = req.ColumnKey,
                cellValue = result.CellValue,
                editorUserName = result.LastEditorUserName,
                updatedAtUtc = result.UpdatedAtUtc
            }, "cell_patched", User.Identity?.Name, ct);
            await _catalog.BroadcastProcessListItemAsync(processId, "data_updated", User.Identity?.Name, ct);
            // An editor holding this canvas needs to know the data under it moved. This is what the
            // canvas/source-side listeners subscribe to.
            await _canvasHub.Clients.Group(CanvasHub.TaskGroup(processId)).SendAsync("canvasChanged", new
            {
                taskId = processId,
                dataSourceId = id,
                reason = "datasource_cell_patched",
                rowIndex = req.RowIndex,
                columnKey = req.ColumnKey,
                userId = UserId,
                userName = User.Identity?.Name
            }, ct);
        }
        return Ok(result);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var dto = await _sources.GetAsync(UserId, id, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] Webautomator.Contracts.DataSources.CreateDataSourceRequest req, CancellationToken ct)
    {
        try
        {
            var created = await _sources.CreateAsync(UserId, req, ct: ct);
            await _catalog.LibrarySourceChangedAsync(new
            {
                id = created.Id,
                title = created.Title,
                columnCount = created.ColumnCount,
                rowCount = created.RowCount,
                fileName = created.FileName
            }, "created", User.Identity?.Name, UserId, ct);
            return Ok(created);
        }
        catch (SourceLimitExceededException ex)
        {
            // Distinct code so the client can show the ceiling message (which names the number and
            // whether the license or the plan set it) instead of a generic "could not create".
            return Conflict(new
            {
                message = ex.Message,
                code = SourceLimitExceededException.Code,
                rowCount = ex.RowCount,
                byteCount = ex.ByteCount,
                maxRows = ex.MaxRows,
                maxBytes = ex.MaxBytes
            });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message, code = "limit" });
        }
    }

    /// <summary>
    /// Create a shared source every signed-in user can read and use. ProcessManager/Admin only.
    /// </summary>
    [HttpPost("public")]
    public async Task<IActionResult> CreatePublic(
        [FromBody] Webautomator.Contracts.DataSources.CreateDataSourceRequest req, CancellationToken ct)
    {
        try
        {
            var created = await _sources.CreatePublicAsync(UserId, req, ct: ct);
            await _catalog.LibrarySourceChangedAsync(new
            {
                id = created.Id,
                title = created.Title,
                columnCount = created.ColumnCount,
                rowCount = created.RowCount,
                fileName = created.FileName,
                isPublic = true
            }, "created", User.Identity?.Name, UserId, ct);
            return Ok(created);
        }
        catch (SourceLimitExceededException ex)
        {
            return Conflict(new
            {
                message = ex.Message,
                code = SourceLimitExceededException.Code,
                rowCount = ex.RowCount,
                byteCount = ex.ByteCount,
                maxRows = ex.MaxRows,
                maxBytes = ex.MaxBytes
            });
        }
        catch (InvalidOperationException ex)
        {
            // Covers both "not allowed to make public sources" and the plan ceiling.
            return BadRequest(new { message = ex.Message, code = "limit" });
        }
    }

    /// <summary>Flip a source this user owns between private and public.</summary>
    [HttpPatch("{id:int}/public")]
    public async Task<IActionResult> SetPublic(int id, [FromBody] Webautomator.Contracts.DataSources.SetPublicSourceRequest req, CancellationToken ct)
    {
        try
        {
            var ok = await _sources.SetPublicAsync(UserId, id, req?.IsPublic == true, ct);
            if (!ok) return NotFound();
            await _catalog.LibrarySourceChangedAsync(new { id, isPublic = req?.IsPublic == true }, "visibility", User.Identity?.Name, UserId, ct);
            return Ok(new { ok = true, id, isPublic = req?.IsPublic == true });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message, code = "forbidden" });
        }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] Webautomator.Contracts.DataSources.UpdateDataSourceRequest req, CancellationToken ct)
    {
        var (ok, error, linked) = await _sources.UpdateTitleAsync(UserId, id, req.Title, ct);
        if (!ok && error == "notfound") return NotFound();
        if (!ok) return BadRequest(new { message = error });

        var title = req.Title?.Trim();
        await _catalog.LibrarySourceChangedAsync(new { id, title }, "renamed", User.Identity?.Name, UserId, ct);
        foreach (var processId in linked)
        {
            await _catalog.SourceChangedAsync(processId, new { id, title }, "renamed", User.Identity?.Name, ct);
            await _catalog.BroadcastProcessListItemAsync(processId, "data_updated", User.Identity?.Name, ct);
            await _canvasHub.Clients.Group(CanvasHub.TaskGroup(processId)).SendAsync("canvasChanged", new
            {
                taskId = processId,
                dataSourceId = id,
                title,
                userId = UserId,
                userName = User.Identity?.Name,
                reason = "datasource_renamed"
            }, ct);
        }

        return Ok(new { ok = true, id, title, linkedProcessIds = linked });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var ok = await _sources.DeleteLibraryAsync(UserId, id, ct);
        if (!ok) return NotFound();
        await _catalog.LibrarySourceChangedAsync(new { id }, "deleted", User.Identity?.Name, UserId, ct);
        return Ok(new { ok = true });
    }

    /// <summary>
    /// Dry-run: would replacing this source's content drop a column that live process nodes read?
    /// The client calls this before writing anything so it can list the affected steps.
    /// </summary>
    [HttpPost("{id:int}/analyze-columns")]
    public async Task<IActionResult> AnalyzeColumns(
        int id, [FromBody] Webautomator.Contracts.DataSources.ReloadDataSourceRequest req, CancellationToken ct)
    {
        var incomingKeys = (req.Columns is { Count: > 0 })
            ? req.Columns.Where(c => !string.IsNullOrWhiteSpace(c.Key)).Select(c => c.Key.Trim()).ToList()
            : (req.ColumnKeys ?? new List<string>());
        var result = await _sources.AnalyzeColumnCompatibilityAsync(UserId, id, incomingKeys, ct);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>
    /// Replace a library source's columns + cells in place, keeping its id, title and process links.
    /// Refused with <c>blocked-missing-columns</c> unless the caller passes <c>force</c>, so a column
    /// dropped by mistake cannot silently break a process that reads it.
    /// </summary>
    [HttpPost("{id:int}/reload")]
    public async Task<IActionResult> Reload(
        int id, [FromBody] Webautomator.Contracts.DataSources.ReloadDataSourceRequest req, CancellationToken ct)
    {
        var result = await _sources.ReloadContentAsync(UserId, id, req, ct);
        if (!result.Ok)
        {
            return result.Code switch
            {
                "notfound" => NotFound(),
                "forbidden" => Forbid(),
                "blocked-missing-columns" => Conflict(result),
                // A limit breach is not a bad request shape — answer 409 so the client can show the
                // ceiling message rather than a generic validation error.
                SourceLimitExceededException.Code => Conflict(result),
                _ => BadRequest(result)
            };
        }

        await _catalog.LibrarySourceChangedAsync(new
        {
            id = result.DataSourceId,
            title = result.DataSourceTitle,
            columnCount = result.ColumnCount,
            rowCount = result.RowCount,
            dataRevision = result.DataRevision
        }, "reloaded", User.Identity?.Name, UserId, ct);

        var linked = await _sources.GetLinkedProcessIdsAsync(id, ct);
        foreach (var processId in linked)
        {
            await _catalog.SourceChangedAsync(processId, new
            {
                id = result.DataSourceId,
                title = result.DataSourceTitle,
                dataRevision = result.DataRevision
            }, "reloaded", User.Identity?.Name, ct);
            await _catalog.BroadcastProcessListItemAsync(processId, "data_updated", User.Identity?.Name, ct);
            // Tell any editor holding this canvas that the source's shape changed under it.
            await _canvasHub.Clients.Group(CanvasHub.TaskGroup(processId)).SendAsync("canvasChanged", new
            {
                taskId = processId,
                dataSourceId = result.DataSourceId,
                reason = "datasource_reloaded",
                userId = UserId,
                userName = User.Identity?.Name
            }, ct);
        }

        return Ok(result);
    }

    [HttpGet("count")]
    public async Task<IActionResult> Count(CancellationToken ct)
    {
        var n = await _entitlements.CountLibraryDataSourcesAsync(UserId, ct);
        return Ok(new { count = n });
    }
}
