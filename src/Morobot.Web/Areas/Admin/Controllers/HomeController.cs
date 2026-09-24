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
            RecentEvents = recentEvents
        };

        return View(vm);
    }
}
