using Morobot.Infrastructure.Services;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class ProcessesController : Controller
{
    private readonly TaskService _tasks;
    private readonly PlaySessionTracker _plays;

    public ProcessesController(TaskService tasks, PlaySessionTracker plays)
    {
        _tasks = tasks;
        _plays = plays;
    }

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewBag.PlayingJson = System.Text.Json.JsonSerializer.Serialize(
            _plays.ListPlaying().Select(p => new
            {
                taskId = p.TaskId,
                userName = p.UserName,
                startedAtUtc = p.StartedAtUtc
            }),
            new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
        var list = await _tasks.ListAllForAdminAsync(ct);
        return View(list);
    }

    [HttpGet]
    public IActionResult Playing()
    {
        return Json(_plays.ListPlaying().Select(p => new
        {
            taskId = p.TaskId,
            userName = p.UserName,
            startedAtUtc = p.StartedAtUtc
        }));
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await _tasks.DeleteAsync(id, ct);
        return RedirectToAction(nameof(Index));
    }
}
