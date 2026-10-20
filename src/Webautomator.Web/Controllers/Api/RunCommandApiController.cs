using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Webautomator.Domain;
using Webautomator.Infrastructure.Services;
using Webautomator.Web.Services;

namespace Webautomator.Web.Controllers.Api;

/// <summary>
/// What a running client must do right now: keep going, stop this run, or stop everything.
/// </summary>
/// <remarks>
/// The play engines already poll for an abort, but that endpoint is anonymous (the extension calls it
/// without a token) — so it can carry a global instruction and nothing that depends on WHO is asking.
/// This one is authenticated on purpose: an administrator closing a session has to reach the client
/// that session belongs to, and the way the client learns that its session is gone is the 401 the dead
/// token produces here. It lives under <c>/api</c> rather than the panel because that is the prefix
/// whose challenge answers 401 instead of redirecting to the login page — a client polling in the
/// background cannot follow a redirect, and "signed out" has to be distinguishable from "portal down".
///
/// Clients that predate this endpoint are unaffected: the global switch is also reported by the older
/// anonymous abort poll, so stopping everything still works on an installation whose extension has not
/// been updated yet.
/// </remarks>
[ApiController]
[Route("api/run-command")]
[Authorize]
public class RunCommandApiController : ControllerBase
{
    private readonly PlaySessionTracker _plays;
    private readonly SystemSettingsService _settings;

    public RunCommandApiController(PlaySessionTracker plays, SystemSettingsService settings)
    {
        _plays = plays;
        _settings = settings;
    }

    /// <summary>
    /// The command for one run. <paramref name="taskId"/> is optional: a client that is starting up, or
    /// running a process it never registered, can still ask whether everything is stopped.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Get(string? taskId, CancellationToken ct)
    {
        taskId = (taskId ?? "").Trim();
        var stopAll = await _settings.GetBoolAsync(SystemSettingKeys.StopAllServerRuns, false, ct);

        // This poll is the liveness signal the tracker relies on: a session that stops asking has
        // stopped running (see PlaySessionTracker.StaleAfter), so it must not block saves forever.
        _plays.Touch(taskId);

        // A per-task abort is consumed on read: it is an instruction for one run, and answering with it
        // twice would stop a run that has already restarted under the same id.
        var aborted = !string.IsNullOrEmpty(taskId) && _plays.ConsumeAbort(taskId);

        return Ok(new
        {
            abort = aborted || stopAll,
            stopAll,
            playing = !string.IsNullOrEmpty(taskId) && _plays.IsPlaying(taskId)
        });
    }
}
