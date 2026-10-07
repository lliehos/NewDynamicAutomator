using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin,Monitor")]
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
    /// <remarks>
    /// Admin-only on purpose. The controller now also admits <c>Monitor</c> so an operator can read
    /// the event and device lists from the monitoring dashboard, but this is the one action here
    /// that destroys evidence — a monitor's whole job is to be able to look, so they must not be
    /// able to erase what they looked at.
    /// </remarks>
    [HttpPost]
    [ValidateAntiForgeryToken]
    [Authorize(Roles = "Admin")]
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
