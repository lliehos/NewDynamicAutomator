using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class SourcesController : Controller
{
    private readonly TaskService _tasks;
    private readonly DataSourceService _sources;

    public SourcesController(TaskService tasks, DataSourceService sources)
    {
        _tasks = tasks;
        _sources = sources;
    }

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var list = await _tasks.ListCanvasSourcesForAdminAsync(ct);
        return View(list);
    }

    [HttpGet]
    public async Task<IActionResult> Detail(int id, CancellationToken ct)
    {
        var dto = await _sources.GetForAdminAsync(id, ct);
        return dto is null ? NotFound() : Json(dto);
    }
}
