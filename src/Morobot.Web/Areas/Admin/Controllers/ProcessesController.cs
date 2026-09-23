using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class ProcessesController : Controller
{
    private readonly TaskService _tasks;

    public ProcessesController(TaskService tasks) => _tasks = tasks;

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var list = await _tasks.ListAllForAdminAsync(ct);
        return View(list);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await _tasks.DeleteAsync(id, ct);
        return RedirectToAction(nameof(Index));
    }
}
