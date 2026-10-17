using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Webautomator.Domain;
using Webautomator.Infrastructure.Services;
using Webautomator.Web.Areas.Admin.Models;
using Webautomator.Web.Services;

namespace Webautomator.Web.Areas.Admin.Controllers;

/// <summary>
/// The monitoring dashboard: this application's own network traffic, who is connected, and the two
/// controls an operator reaches for while something is running away.
/// </summary>
/// <remarks>
/// Readable by the <see cref="Webautomator.Domain.Enums.UserRole.Monitor"/> role as well as Admin, and
/// the actions here are deliberately available to BOTH. The rest of the Admin area stays Admin-only,
/// but a monitor's job is to watch the deployment — and a watcher who cannot stop a runaway run, or
/// close the session of an account that is misbehaving, has to fetch an administrator while the load
/// keeps climbing. The two controls are narrow: they stop runs and they end sessions. Nothing here
/// edits data, plans, users or configuration.
/// </remarks>
[Area("Admin")]
[Authorize(Roles = "Admin,Monitor")]
public class MonitoringController : Controller
{
    private readonly MonitoringService _monitoring;
    private readonly PlaySessionTracker _plays;
    private readonly SystemSettingsService _settings;
    private readonly SessionGuard _sessions;
    private readonly EventLogService _events;
    private readonly ILocaleService _locale;

    public MonitoringController(
        MonitoringService monitoring,
        PlaySessionTracker plays,
        SystemSettingsService settings,
        SessionGuard sessions,
        EventLogService events,
        ILocaleService locale)
    {
        _monitoring = monitoring;
        _plays = plays;
        _settings = settings;
        _sessions = sessions;
        _events = events;
        _locale = locale;
    }

    public async Task<IActionResult> Index(int hours = 24, CancellationToken ct = default)
    {
        ViewData["Title"] = _locale["admin.monitoring.title"];
        var model = new MonitoringViewModel
        {
            Snapshot = await CaptureAsync(hours, ct),
            IsRtl = _locale.IsRtl,
            // The same master switch Admin → Settings shows. It lives here too because the operator
            // watching live sessions is the one who needs to stop them, and sending them to another
            // page mid-incident would be the wrong kind of tidiness.
            ServerRunEnabled = await _settings.IsServerRunEnabledAsync(ct),
            CanToggleServerRun = User.IsInRole("Admin")
        };
        return View(model);
    }

    /// <summary>A JSON reading, so the page refreshes its figures without a full reload.</summary>
    [HttpGet]
    public async Task<IActionResult> Snapshot(int hours = 24, CancellationToken ct = default)
    {
        var s = await CaptureAsync(hours, ct);
        return Json(new
        {
            capturedAtUtc = s.CapturedAtUtc,
            databaseReachable = s.DatabaseReachable,
            databasePingMs = s.DatabasePingMs,
            networkReceivedBytes = s.NetworkReceivedBytes,
            networkSentBytes = s.NetworkSentBytes,
            networkInPerSec = s.NetworkInPerSec,
            networkOutPerSec = s.NetworkOutPerSec,
            windowBytesIn = s.WindowBytesIn,
            windowBytesOut = s.WindowBytesOut,
            liveSessions = s.LiveSessions,
            onlineUsers = s.OnlineUsers,
            distinctIpCount = s.DistinctIpCount,
            windowHours = s.WindowHours,
            stopAllServerRuns = s.StopAllServerRuns,
            // The chart is part of the live view: it is already collapsed into a fixed number of
            // buckets by the service, so re-reading it costs a few hundred bytes and the page can
            // redraw it in place. Without this the columns only ever moved on a full reload.
            history = s.History.Select(p => new
            {
                atUtc = p.AtUtc,
                bytesIn = p.BytesIn,
                bytesOut = p.BytesOut,
                onlineUsers = p.OnlineUsers,
                liveSessions = p.LiveSessions
            })
        });
    }

    /// <summary>
    /// Stop every server-side run belonging to one user, leaving that user signed in.
    /// </summary>
    /// <remarks>
    /// Server-side runs are the ones registered here, so this is exactly the list the page is showing.
    /// A run the user started with the feature switched off never registered and is not reachable from
    /// this application at all — that is what <see cref="CloseUserSession"/> is for.
    /// </remarks>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> StopUserRuns(int userId, CancellationToken ct = default)
    {
        var tasks = _plays.RequestAbortForUser(userId);
        await AuditAsync(
            "MonitoringStopRuns",
            userId,
            $"Monitoring: asked {tasks.Count} server-side run(s) of user {userId} to stop",
            ct);
        return Json(new { stopped = tasks.Count });
    }

    /// <summary>
    /// Close everything a user has open: their server-side runs, their session everywhere, and the
    /// live connections that carry it.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> CloseUserSession(int userId, CancellationToken ct = default)
    {
        var tasks = _plays.RequestAbortForUser(userId);
        var version = await _sessions.CloseAsync(userId, User.Identity?.Name, "monitoring dashboard", ct);
        await AuditAsync(
            "MonitoringCloseSession",
            userId,
            $"Monitoring: closed the session of user {userId} (stopped {tasks.Count} run(s), session version {version})",
            ct);
        return Json(new { stopped = tasks.Count, sessionVersion = version });
    }

    /// <summary>
    /// Turn the stop-all switch on or off.
    /// </summary>
    /// <remarks>
    /// Switching it ON also stops what is already running, because "stop all runs" that only guarded
    /// the next one would leave the operator watching the very load they just tried to end. Switching
    /// it OFF changes nothing else: the runs that were stopped stay stopped.
    ///
    /// The value is written through the settings service, which records the change (with the actor and
    /// the old value) in the audit log by itself.
    /// </remarks>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SetStopAll(bool on, CancellationToken ct = default)
    {
        var actorId = int.TryParse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var id)
            ? id
            : (int?)null;

        await _settings.SetAsync(
            SystemSettingKeys.StopAllServerRuns,
            on ? "true" : "false",
            actorId,
            User.Identity?.Name,
            ct);

        var stopped = on ? _plays.RequestAbortAll() : Array.Empty<string>();
        return Json(new { stopAll = on, stopped = stopped.Count });
    }

    /// <summary>Both actions write the same shape of audit entry: who did it, to whom, and what happened.</summary>
    private async Task AuditAsync(string eventType, int userId, string message, CancellationToken ct)
    {
        var actorId = int.TryParse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var id)
            ? id
            : (int?)null;

        await _events.LogAsync(
            "Audit",
            "Monitoring",
            eventType,
            message,
            userId: actorId,
            userName: User.Identity?.Name,
            detailsJson: System.Text.Json.JsonSerializer.Serialize(new
            {
                targetUserId = userId,
                actor = User.Identity?.Name,
                ip = HttpContext.Connection.RemoteIpAddress?.ToString()
            }),
            ipAddress: HttpContext.Connection.RemoteIpAddress?.ToString(),
            ct: ct);
    }

    /// <summary>Shared by both actions so the page and the poll can never compute different numbers.</summary>
    private async Task<MonitoringSnapshot> CaptureAsync(int hours, CancellationToken ct)
    {
        // One entry per RUN (not per user): the same account running two processes is two sessions, and
        // the page shows the count of runs as well as the count of users.
        var playing = _plays.ListPlaying().Select(p => p.UserId).ToList();
        return await _monitoring.CaptureAsync(playing, hours, ct);
    }
}