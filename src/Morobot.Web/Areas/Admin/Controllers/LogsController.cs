using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class LogsController : Controller
{
    private readonly EventLogService _events;

    public LogsController(EventLogService events) => _events = events;

    public async Task<IActionResult> Index(string? level = null, string? category = null, CancellationToken ct = default)
    {
        ViewData["Title"] = "Events & errors";
        ViewBag.Level = level;
        ViewBag.Category = category;
        var logs = await _events.ListAsync(level, category, 200, ct);
        return View(logs);
    }

    public async Task<IActionResult> Devices(CancellationToken ct = default)
    {
        ViewData["Title"] = "Devices";
        var devices = await _events.ListDevicesAsync(200, ct);
        return View(devices);
    }

    /// <summary>
    /// Delete event log rows, honoring the level/category filter the admin is currently viewing so
    /// "clear" means "clear what I see" rather than silently wiping the whole table when a filter
    /// is on. The audit entry is written AFTER the delete so it survives its own purge.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Clear(string? level = null, string? category = null, CancellationToken ct = default)
    {
        var removed = await _events.ClearAsync(level, category, ct);
        if (removed > 0)
        {
            await _events.LogAsync(
                "Audit", "System", "EventLogsCleared",
                $"Admin cleared {removed} event log row(s)"
                    + (string.IsNullOrWhiteSpace(level) ? "" : $" [level={level}]")
                    + (string.IsNullOrWhiteSpace(category) ? "" : $" [category={category}]"),
                userName: User.Identity?.Name,
                ct: ct);
        }
        return RedirectToAction(nameof(Index), new { level, category });
    }
}
