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
}
