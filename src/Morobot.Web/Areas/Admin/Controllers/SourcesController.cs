using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class SourcesController : Controller
{
    private readonly TaskService _tasks;

    public SourcesController(TaskService tasks) => _tasks = tasks;

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var list = await _tasks.ListCanvasSourcesForAdminAsync(ct);
        return View(list);
    }
}
