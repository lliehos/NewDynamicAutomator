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
    private readonly ILocaleService _locale;

    public ProcessesController(TaskService tasks, PlaySessionTracker plays, ILocaleService locale)
    {
        _tasks = tasks;
        _plays = plays;
        _locale = locale;
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

    /// <summary>
    /// Delete the rows the admin ticked in the list. Each id goes through the same
    /// <see cref="TaskService.DeleteAsync"/> as the single delete, so a mother still takes its
    /// template with it and its children are still detached.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteMany(int[] ids, CancellationToken ct)
    {
        var deleted = 0;
        foreach (var id in (ids ?? Array.Empty<int>()).Distinct())
        {
            // DeleteAsync answers -1 for an id that is already gone, which must not be reported as
            // a deletion.
            if (await _tasks.DeleteAsync(id, ct) != -1) deleted++;
        }
        if (deleted > 0)
        {
            TempData["Ok"] = _locale.T("admin.processes.deletedMany", ("count", deleted.ToString()));
        }
        return RedirectToAction(nameof(Index));
    }
}
