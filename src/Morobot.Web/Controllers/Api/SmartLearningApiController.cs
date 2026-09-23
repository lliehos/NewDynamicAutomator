using Morobot.Contracts.SmartLearning;
using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Controllers.Api;

/// <summary>
/// Soft smart-learning API for Smart Recorder.
/// Soft-creates sessions and stores raw contexts; Microsoft LM inference later.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/smart-learning")]
public class SmartLearningApiController : ControllerBase
{
    private readonly SmartLearningService _smart;

    public SmartLearningApiController(SmartLearningService smart) => _smart = smart;

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
    public ActionResult<SmartSessionSaveResponse> Save(string sessionId)
    {
        try
        {
            // Soft empty — learning / graph apply comes with Microsoft LM later.
            return Ok(_smart.SaveResult(sessionId));
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { });
        }
    }
}
