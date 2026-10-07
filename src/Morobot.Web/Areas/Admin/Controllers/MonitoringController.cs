using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Infrastructure.Services;
using Morobot.Web.Areas.Admin.Models;
using Morobot.Web.Services;

namespace Morobot.Web.Areas.Admin.Controllers;

/// <summary>
/// The server-resource monitoring dashboard: how much of the machine the deployment is using, how
/// the load is split across plans and users, and what has been going wrong.
/// </summary>
/// <remarks>
/// Deliberately a separate controller from <c>HomeController</c>, and deliberately readable by the
/// <see cref="Morobot.Domain.Enums.UserRole.Monitor"/> role as well as Admin. The rest of the Admin
/// area stays Admin-only: a monitor operator watches, and every action surface (users, plans,
/// branding, licence, migration) remains out of reach for them. Making this one page the exception
/// is what the role exists for, so the attribute names both roles explicitly rather than relying on
/// a base class or a convention that would quietly widen with it.
/// </remarks>
[Area("Admin")]
[Authorize(Roles = "Admin,Monitor")]
public class MonitoringController : Controller
{
    private readonly MonitoringService _monitoring;
    private readonly PlaySessionTracker _plays;
    private readonly EventLogService _events;
    private readonly ILocaleService _locale;

    public MonitoringController(
        MonitoringService monitoring,
        PlaySessionTracker plays,
        EventLogService events,
        ILocaleService locale)
    {
        _monitoring = monitoring;
        _plays = plays;
        _events = events;
        _locale = locale;
    }

    public async Task<IActionResult> Index(int hours = 24, CancellationToken ct = default)
    {
        ViewData["Title"] = _locale["admin.monitoring.title"];

        // Live figures come from the in-memory tracker, which only knows what is running right now.
        // Everything durable in the snapshot is read from the database by the service.
        var snapshot = await CaptureAsync(hours, ct);
        var model = new MonitoringViewModel
        {
            Snapshot = snapshot,
            IsRtl = _locale.IsRtl
        };
        return View(model);
    }

    /// <summary>
    /// A JSON reading, so the page can refresh its figures without a full reload.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Snapshot(int hours = 24, CancellationToken ct = default)
    {
        var s = await CaptureAsync(hours, ct);
        return Json(new
        {
            capturedAtUtc = s.CapturedAtUtc,
            databaseReachable = s.DatabaseReachable,
            databasePingMs = s.DatabasePingMs,
            processWorkingSetBytes = s.ProcessWorkingSetBytes,
            processPrivateBytes = s.ProcessPrivateBytes,
            totalPhysicalBytes = s.TotalPhysicalBytes,
            availablePhysicalBytes = s.AvailablePhysicalBytes,
            managedHeapBytes = s.ManagedHeapBytes,
            processorSeconds = s.ProcessorSeconds,
            threadCount = s.ThreadCount,
            gen2Collections = s.Gen2Collections,
            logicalProcessors = s.LogicalProcessors,
            processUptimeSeconds = s.ProcessUptime.TotalSeconds,
            networkReceivedBytes = s.NetworkReceivedBytes,
            networkSentBytes = s.NetworkSentBytes,
            diskReadBytes = s.DiskReadBytes,
            diskWriteBytes = s.DiskWriteBytes,
            networkInPerSec = s.NetworkInPerSec,
            networkOutPerSec = s.NetworkOutPerSec,
            diskReadPerSec = s.DiskReadPerSec,
            diskWritePerSec = s.DiskWritePerSec,
            liveSessions = s.LiveSessions,
            onlineUsers = s.OnlineUsers,
            distinctIpCount = s.DistinctIpCount,
            events24h = s.Events24h,
            problemEvents24h = s.ProblemEvents24h,
            plays24h = s.Plays24h,
            requestCount24h = s.RequestCount24h,
            windowHours = s.WindowHours,
            history = s.History.Select(p => new
            {
                atUtc = p.AtUtc,
                bytesIn = p.BytesIn,
                bytesOut = p.BytesOut,
                diskRead = p.DiskRead,
                diskWrite = p.DiskWrite,
                workingSetBytes = p.WorkingSetBytes,
                availableBytes = p.AvailableBytes,
                liveSessions = p.LiveSessions,
                onlineUsers = p.OnlineUsers
            })
        });
    }

    /// <summary>Shared by both actions so the page and the poll can never compute different numbers.</summary>
    private async Task<Infrastructure.Services.MonitoringSnapshot> CaptureAsync(int hours, CancellationToken ct)
    {
        var playing = _plays.ListPlaying();
        var playingUserIds = playing.Where(p => p.UserId is > 0).Select(p => p.UserId!.Value).ToHashSet();
        var lastSeen = await _events.GetLastSeenByUserAsync(ct);
        var now = DateTime.UtcNow;
        var onlineUsers = lastSeen.Keys
            .Union(playingUserIds)
            .Count(uid => EventLogService.IsOnline(
                lastSeen.TryGetValue(uid, out var s) ? s : null,
                playingUserIds.Contains(uid),
                now));
        return await _monitoring.CaptureAsync(playing.Count, onlineUsers, hours, ct);
    }
}
