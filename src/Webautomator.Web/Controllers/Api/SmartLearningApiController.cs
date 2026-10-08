using Webautomator.Contracts.SmartLearning;
using Webautomator.Infrastructure.Services;
using Webautomator.Web.Hubs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using Webautomator.Infrastructure.Persistence;

namespace Webautomator.Web.Controllers.Api;

/// <summary>
/// Soft smart-learning API for Smart Recorder.
/// Soft-creates sessions and stores raw contexts; Microsoft LM inference later.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/smart-learning")]
public class SmartLearningApiController : ControllerBase
{
    /// <summary>
    /// The canvas stores camelCase, so the graph must be written the same way the editor would have
    /// written it — otherwise the editor would read its own diagram back with PascalCase keys.
    /// </summary>
    private static readonly System.Text.Json.JsonSerializerOptions CanvasJsonOpts = new()
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
    };

    private readonly SmartLearningService _smart;
    private readonly TaskService _tasks;
    private readonly AppDbContext _db;
    private readonly IHubContext<CanvasHub> _canvasHub;

    public SmartLearningApiController(
        SmartLearningService smart,
        TaskService tasks,
        AppDbContext db,
        IHubContext<CanvasHub> canvasHub)
    {
        _smart = smart;
        _tasks = tasks;
        _db = db;
        _canvasHub = canvasHub;
    }

    /// <summary>Health — empty 200 when portal is up.</summary>
    [HttpGet("ping")]
    public IActionResult Ping() => Ok(new { });

    [HttpPost("sessions")]
    public ActionResult<StartSmartSessionResponse> Start([FromBody] StartSmartSessionRequest? request)
    {
        request ??= new StartSmartSessionRequest();
        if (request.TaskId == 0)
            return BadRequest(new { message = "taskId لازم است." });
        if (string.IsNullOrWhiteSpace(request.LocalUser))
            request.LocalUser = Request.Headers["X-Da-Local-User"].FirstOrDefault() ?? "test";
        // Soft-create — minimal session payload, no AI result.
        return Ok(_smart.Start(request));
    }

    [HttpPost("sessions/{sessionId}/contexts")]
    public ActionResult<AppendSmartContextsResponse> AppendContexts(
        string sessionId,
        [FromBody] AppendSmartContextsRequest? request)
    {
        try
        {
            return Ok(_smart.AppendContexts(sessionId, request ?? new AppendSmartContextsRequest()));
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { });
        }
    }

    [HttpPost("sessions/{sessionId}/stop")]
    public ActionResult<SmartSessionStopResponse> Stop(string sessionId)
    {
        try
        {
            return Ok(_smart.Stop(sessionId));
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { });
        }
    }

    [HttpGet("sessions/{sessionId}")]
    public ActionResult<SmartSessionStatusResponse> Get(string sessionId)
    {
        var doc = _smart.Get(sessionId);
        return doc is null ? NotFound(new { }) : Ok(doc);
    }

    [HttpPost("sessions/{sessionId}/save")]
    public async Task<ActionResult<SmartSessionSaveResponse>> Save(string sessionId, CancellationToken ct)
    {
        SmartSessionSaveResponse result;
        try
        {
            result = _smart.SaveResult(sessionId);
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { });
        }

        if (!result.Ok)
            return Ok(result);

        // The learning service builds the graph; the canvas is owned by the task repository, so the
        // write happens here. Without this the recording produced a graph that was never persisted
        // and the process stayed empty — the save looked successful and changed nothing.
        var taskId = result.TaskId;
        if (taskId is null or <= 0)
        {
            return Ok(new SmartSessionSaveResponse
            {
                Ok = false,
                Message = "فرآیند هدف برای ذخیره مشخص نیست.",
                TaskId = result.TaskId
            });
        }

        // The canvas repository keys on int while the smart-session contract uses long. A value that
        // does not fit cannot be a real process id here, so it is rejected rather than truncated to
        // an unrelated process.
        if (taskId.Value > int.MaxValue)
        {
            return Ok(new SmartSessionSaveResponse
            {
                Ok = false,
                Message = "شناسهٔ فرآیند نامعتبر است.",
                TaskId = result.TaskId
            });
        }
        var canvasTaskId = (int)taskId.Value;

        var json = System.Text.Json.JsonSerializer.Serialize(result.Graph, CanvasJsonOpts);

        // The extension has no portal session, so the process creator acts as the writer.
        var ownerUserId = await OwnerUserIdForAsync(canvasTaskId, ct);
        var (ok, error, _) = await _tasks.SaveCanvasJsonAsync(
            ownerUserId, canvasTaskId, json, title: null, baseUpdatedAtUtc: null,
            entitlements: null, ct);

        if (!ok)
        {
            return Ok(new SmartSessionSaveResponse
            {
                Ok = false,
                Message = error switch
                {
                    "forbidden" => "دسترسی به این فرآیند برای ذخیره وجود ندارد.",
                    "notfound" => "فرآیند هدف پیدا نشد.",
                    "conflict" => "فرآیند جای دیگری تغییر کرده است.",
                    _ => "ذخیرهٔ گراف روی فرآیند ناموفق بود."
                },
                TaskId = taskId
            });
        }

        await NotifyCanvasChanged(canvasTaskId, ct);
        return Ok(result);
    }

    /// <summary>
    /// Same graph as <c>save</c>, returned as clipboard text — this does not touch the process.
    /// Kept separate so a user can paste the recording into a diagram by hand, which is the point
    /// of the copy button.
    /// </summary>
    [HttpPost("sessions/{sessionId}/copy")]
    public ActionResult<SmartSessionCopyResponse> Copy(string sessionId)
    {
        try
        {
            return Ok(_smart.CopyResult(sessionId));
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { });
        }
    }

    /// <summary>
    /// Resolve the user whose permission covers writing this task's canvas.
    ///
    /// This endpoint is anonymous: the recorder lives in a browser extension and holds no portal
    /// cookie, so "the caller" does not exist here. The recording was started from the process list
    /// by a signed-in user, so the process creator is the right owner to act as — and using them
    /// keeps the write inside the same permission the user already had when they started recording.
    /// </summary>
    private async Task<int> OwnerUserIdForAsync(int taskId, CancellationToken ct)
    {
        var creator = await _db.Processes.AsNoTracking()
            .Where(p => p.Id == taskId)
            .Select(p => p.CreatorUserId)
            .FirstOrDefaultAsync(ct);
        if (creator is int id and > 0) return id;

        // No creator recorded — fall back to anyone the process is shared with who may edit it, so a
        // legacy row still saves instead of failing as "forbidden".
        var editor = await _db.ProcessShares.AsNoTracking()
            .Where(s => s.ProcessId == taskId && s.CanEdit)
            .Select(s => s.UserId)
            .FirstOrDefaultAsync(ct);
        return editor;
    }

    /// <summary>
    /// Tell every editor looking at this process that the canvas moved.
    ///
    /// The recorder writes the graph server-side, so an open editor would otherwise keep showing the
    /// old diagram until a manual reload. This is the same signal the canvas PUT endpoint sends.
    /// </summary>
    private async Task NotifyCanvasChanged(int taskId, CancellationToken ct)
    {
        try
        {
            await _canvasHub.Clients.Group(CanvasHub.TaskGroup(taskId)).SendAsync("canvasChanged", new
            {
                taskId,
                reason = "smart_recording_saved",
                updatedAtUtc = DateTime.UtcNow
            }, ct);
        }
        catch
        {
            // Best effort: the graph is already committed, a missing notification must not fail it.
        }
    }
}
