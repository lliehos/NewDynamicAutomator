using Webautomator.Domain;
using Webautomator.Infrastructure.Services;
using Webautomator.Web.Hubs;
using Webautomator.Web.Services;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace Webautomator.Web.Controllers.Api;

/// <summary>
/// The master switch for SERVER runs, shared by the panel, the extension and the desktop player.
/// </summary>
/// <remarks>
/// This is the one server-run control that is deployment-wide rather than per process: when an
/// operator turns it off (Admin → Settings, or the same switch on the monitoring dashboard), every
/// process has to be run locally from the processes list, and any run currently registered on the
/// server is stopped at once with an explicit reason — a live session that kept going after the
/// capability was withdrawn would be exactly the sort of silent divergence the switch exists to
/// prevent.
///
/// GET is readable by any signed-in user because every client has to know before it offers a run
/// type; PUT is Admin-only, which is why it lives here rather than in the Admin area (the panel and
/// the extension are area-agnostic, and the Admin area itself is unreachable from the panel).
/// </remarks>
[ApiController]
[Route("api/play-mode")]
public class PlayModeApiController : ControllerBase
{
    private readonly SystemSettingsService _settings;
    private readonly PlaySessionTracker _plays;
    private readonly IHubContext<PlayDataHub> _playHub;
    private readonly IHubContext<CanvasHub> _canvasHub;
    private readonly CatalogLiveService _catalog;
    private readonly EventLogService _events;

    public PlayModeApiController(
        SystemSettingsService settings,
        PlaySessionTracker plays,
        IHubContext<PlayDataHub> playHub,
        IHubContext<CanvasHub> canvasHub,
        CatalogLiveService catalog,
        EventLogService events)
    {
        _settings = settings;
        _plays = plays;
        _playHub = playHub;
        _canvasHub = canvasHub;
        _catalog = catalog;
        _events = events;
    }

    /// <summary>Is running on the server allowed? Every run-type UI reads this before offering one.</summary>
    [HttpGet]
    [Authorize]
    public async Task<IActionResult> Get(CancellationToken ct)
        => Ok(new { serverRunEnabled = await _settings.IsServerRunEnabledAsync(ct) });

    /// <summary>
    /// Turn server runs on or off. Turning them OFF also stops every live server run, with the
    /// reason shown to each player, and tells every open client so their menus update at once.
    /// </summary>
    [HttpPut]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Set([FromBody] SetServerRunRequest body, CancellationToken ct)
    {
        var enabled = body?.ServerRunEnabled != false;
        await _settings.SetAsync(
            SystemSettingKeys.ServerRunEnabled, enabled ? "true" : "false",
            actorUserId: UserId,
            actorUserName: User.Identity?.Name,
            ct: ct);
        await _events.LogAsync(
            "Audit", "Play", enabled ? "ServerRunEnabled" : "ServerRunDisabled",
            enabled
                ? $"Server runs enabled by {User.Identity?.Name}"
                : $"Server runs disabled by {User.Identity?.Name}",
            UserId, User.Identity?.Name,
            path: "/api/play-mode",
            ipAddress: HttpContext.Connection.RemoteIpAddress?.ToString(),
            ct: ct);

        var stopped = new List<object>();
        if (!enabled)
        {
            // Stop every live SERVER run. A local run was never registered here, so it is untouched —
            // which is exactly why a local run keeps working while server runs are switched off.
            //
            // The abort flag is what actually stops the run: the engine's abort poll (only a
            // server-managed run has one) reads it within ~1.5s and calls stopPlay("canvas_changed").
            // The hub message is the immediate half — it lets the player's HUD say WHY, instead of
            // reporting a bare "the process changed".
            foreach (var session in _plays.ListPlaying())
            {
                var taskId = session.TaskId;
                if (string.IsNullOrWhiteSpace(taskId)) continue;
                _plays.RequestAbort(taskId);
                var payload = new
                {
                    taskId,
                    reason = "server_run_disabled",
                    message = "اجرای روی سرور توسط مدیر غیرفعال شد؛ اجرا متوقف شد. برای ادامه از اجرای محلی (منوی دکمهٔ اجرا در لیست فرآیندها) استفاده کنید.",
                    actorUserName = User.Identity?.Name
                };
                await _playHub.Clients.Group(PlayDataHub.TaskGroup(taskId))
                    .SendAsync("playStopDueToChange", payload, ct);
                if (int.TryParse(taskId, out var processId))
                {
                    await _canvasHub.Clients.Group(CanvasHub.TaskGroup(processId))
                        .SendAsync("playStopDueToChange", payload, ct);
                    await _catalog.NotifyPlayStateAsync(taskId, false, null, ct);
                }
                stopped.Add(new { taskId, userName = session.UserName });
            }
        }

        return Ok(new { ok = true, serverRunEnabled = enabled, stopped });
    }

    private int UserId => int.TryParse(User.FindFirstValue(System.Security.Claims.ClaimTypes.NameIdentifier), out var id) ? id : 0;
}

/// <summary>Request body for the server-run master switch.</summary>
public class SetServerRunRequest
{
    public bool ServerRunEnabled { get; set; } = true;
}
