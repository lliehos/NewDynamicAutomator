using System.Security.Claims;
using DynamicAutomator.Contracts.Tasks;
using DynamicAutomator.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Controllers;

[Authorize]
public class TasksController : Controller
{
    private readonly TaskService _tasks;
    private readonly GraphService _graph;

    public TasksController(TaskService tasks, GraphService graph)
    {
        _tasks = tasks;
        _graph = graph;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(string title, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(title))
            return RedirectToAction("Index", "Home");
        var task = await _tasks.CreateAsync(UserId, new CreateTaskRequest { Title = title.Trim() }, ct);
        return RedirectToAction(nameof(Editor), new { id = task.Id });
    }

    [HttpGet]
    public async Task<IActionResult> Editor(int id, CancellationToken ct)
    {
        if (!await _tasks.CanViewAsync(UserId, id, ct))
            return Forbid();
        ViewBag.TaskId = id;
        ViewBag.CanModify = await _tasks.CanModifyAsync(UserId, id, ct);
        return View();
    }

    [HttpGet]
    public async Task<IActionResult> Graph(int id, CancellationToken ct)
    {
        var graph = await _graph.GetAsync(UserId, id, ct);
        return graph is null ? NotFound() : Json(graph);
    }

    [HttpPost]
    [IgnoreAntiforgeryToken]
    public async Task<IActionResult> SaveGraph(int id, [FromBody] SaveTaskGraphRequest request, CancellationToken ct)
    {
        try
        {
            return Json(await _graph.SaveAsync(UserId, id, request, ct));
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }
}
