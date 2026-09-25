using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Morobot.Domain;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Morobot.Web.Areas.Admin.Models;
using Morobot.Web.Services;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class HomeController : Controller
{
    private readonly ILocaleService _locale;
    private readonly AppDbContext _db;
    private readonly SystemSettingsService _settings;
    private readonly PlaySessionTracker _plays;
    private readonly EventLogService _events;

    public HomeController(
        ILocaleService locale,
        AppDbContext db,
        SystemSettingsService settings,
        PlaySessionTracker plays,
        EventLogService events)
    {
        _locale = locale;
        _db = db;
        _settings = settings;
        _plays = plays;
        _events = events;
    }

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = _locale["admin.dashboard.title"];
        var since = DateTime.UtcNow.AddHours(-24);
        var isFa = _locale.IsRtl;

        var userCount = await _db.Users.CountAsync(ct);
        var activeUserCount = await _db.Users.CountAsync(u => u.IsActive, ct);
        var processCount = await _db.Processes.CountAsync(ct);
        var sourceCount = await _db.DataSources.CountAsync(ct);
        var planCount = await _db.Plans.CountAsync(p => p.IsActive, ct);
        var eventCount24h = await _db.EventLogs.CountAsync(e => e.CreatedAtUtc >= since, ct);
        var playingCount = _plays.ListPlaying().Count;
        var playingUserIds = _plays.ListPlaying()
            .Where(p => p.UserId is > 0)
            .Select(p => p.UserId!.Value)
            .ToHashSet();
        var lastSeen = await _events.GetLastSeenByUserAsync(ct);
        var now = DateTime.UtcNow;
        var onlineUserCount = lastSeen.Keys
            .Union(playingUserIds)
            .Count(uid => EventLogService.IsOnline(
                lastSeen.TryGetValue(uid, out var s) ? s : null,
                playingUserIds.Contains(uid),
                now));

        var defaultPlan = await _settings.GetDefaultRegisterPlanAsync(ct);
        var defaultPlanName = isFa ? defaultPlan.NameFa : defaultPlan.NameEn;

        var planStats = await _db.Plans.AsNoTracking()
            .OrderBy(p => p.SortOrder)
            .Select(p => new AdminPlanStat
            {
                Code = p.Code,
                Name = isFa ? p.NameFa : p.NameEn,
                UserCount = p.Users.Count,
                IsActive = p.IsActive
            })
            .ToListAsync(ct);

        var recentEvents = await _db.EventLogs.AsNoTracking()
            .OrderByDescending(e => e.CreatedAtUtc)
            .Take(8)
            .Select(e => new AdminRecentEvent
            {
                CreatedAtUtc = e.CreatedAtUtc,
                Level = e.Level,
                Category = e.Category,
                EventType = e.EventType,
                Message = e.Message,
                UserName = e.UserName
            })
            .ToListAsync(ct);

        // ---- Analytics for the dashboard charts ------------------------------------
        // One window (14 days) drives the trend chart, the level split and the deltas.
        const int windowDays = 14;
        var windowStart = DateTime.UtcNow.Date.AddDays(-(windowDays - 1));

        var eventsInWindow = await _db.EventLogs.AsNoTracking()
            .Where(e => e.CreatedAtUtc >= windowStart)
            .Select(e => new { e.CreatedAtUtc, e.Level })
            .ToListAsync(ct);

        var processesInWindow = await _db.Processes.AsNoTracking()
            .Where(p => p.CreatedAtUtc >= windowStart)
            .Select(p => p.CreatedAtUtc)
            .ToListAsync(ct);

        // Play history comes from the event log, not from the live tracker. The tracker only
        // holds sessions that are still running, so reading it here would have under-reported
        // every past day and silently dropped any run that had already finished.
        var playsInWindow = await _db.EventLogs.AsNoTracking()
            .Where(e => e.Category == "Play" && e.EventType == "PlayStarted" && e.CreatedAtUtc >= windowStart)
            .Select(e => e.CreatedAtUtc)
            .ToListAsync(ct);

        var daily = new List<AdminDailyPoint>(windowDays);
        for (var d = 0; d < windowDays; d++)
        {
            var day = windowStart.AddDays(d);
            var next = day.AddDays(1);
            daily.Add(new AdminDailyPoint
            {
                Label = day.ToString("MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                Events = eventsInWindow.Count(e => e.CreatedAtUtc >= day && e.CreatedAtUtc < next),
                Processes = processesInWindow.Count(t => t >= day && t < next),
                Plays = playsInWindow.Count(t => t >= day && t < next)
            });
        }

        var eventLevels = eventsInWindow
            .GroupBy(e => string.IsNullOrWhiteSpace(e.Level) ? "Info" : e.Level)
            .Select(g => new AdminLevelStat { Level = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .ToList();

        // Two more real series over the same window, so the charts all share one time axis and
        // one window (and therefore agree with each other and with the stat tiles above them).
        var signupsInWindow = await _db.Users.AsNoTracking()
            .Where(u => u.CreatedAtUtc >= windowStart)
            .Select(u => u.CreatedAtUtc)
            .ToListAsync(ct);

        var devicesInWindow = await _db.DeviceSessions.AsNoTracking()
            .Where(d => d.FirstSeenUtc >= windowStart)
            .Select(d => d.FirstSeenUtc)
            .ToListAsync(ct);

        for (var d = 0; d < windowDays; d++)
        {
            var day = windowStart.AddDays(d);
            var next = day.AddDays(1);
            daily[d].Signups = signupsInWindow.Count(t => t >= day && t < next);
            daily[d].NewDevices = devicesInWindow.Count(t => t >= day && t < next);
        }

        var topOwners = await _db.Users.AsNoTracking()
            .Select(u => new AdminTopUser
            {
                UserName = u.UserName ?? "—",
                ProcessCount = u.CreatedProcesses.Count,
                SourceCount = _db.DataSources.Count(d => d.OwnerUserId == u.Id)
            })
            .OrderByDescending(x => x.ProcessCount)
            .ThenByDescending(x => x.SourceCount)
            .Take(6)
            .ToListAsync(ct);

        var last7 = DateTime.UtcNow.Date.AddDays(-6);
        // Same reasoning as playsInWindow: count recorded play starts, not live sessions.
        var plays7d = playsInWindow.Count(t => t >= last7);
        var processes7d = processesInWindow.Count(t => t >= last7);
        var problemEvents7d = eventsInWindow.Count(e =>
            e.CreatedAtUtc >= last7 &&
            (string.Equals(e.Level, "Error", StringComparison.OrdinalIgnoreCase)
             || string.Equals(e.Level, "Warn", StringComparison.OrdinalIgnoreCase)
             || string.Equals(e.Level, "Warning", StringComparison.OrdinalIgnoreCase)));

        var vm = new AdminDashboardViewModel
        {
            UserCount = userCount,
            ActiveUserCount = activeUserCount,
            ProcessCount = processCount,
            SourceCount = sourceCount,
            PlanCount = planCount,
            PlayingCount = playingCount,
            OnlineUserCount = onlineUserCount,
            EventCount24h = eventCount24h,
            DefaultPlanCode = defaultPlan.Code,
            DefaultPlanName = defaultPlanName,
            PlanStats = planStats,
            RecentEvents = recentEvents,
            DailyActivity = daily,
            EventLevels = eventLevels,
            TopProcessOwners = topOwners,
            Plays7d = plays7d,
            Processes7d = processes7d,
            ProblemEvents7d = problemEvents7d
        };

        return View(vm);
    }
}
