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
    private readonly DataSourceService _dataSources;

    public TasksController(TaskService tasks, GraphService graph, DataSourceService dataSources)
    {
        _tasks = tasks;
        _graph = graph;
        _dataSources = dataSources;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult Create(string title)
    {
        // Local-first: manual create happens in browser JS; this is a fallback redirect shell.
        if (string.IsNullOrWhiteSpace(title))
            return RedirectToAction("Index", "Home");
        return RedirectToAction("Index", "Home");
    }

    [HttpGet]
    public IActionResult Editor(long id)
    {
        // Local-first: graph lives in localStorage; no DB permission check.
        // IDs are Date.now() (ms) from the extension/local-tasks — must be long, not int.
        ViewBag.TaskId = id;
        ViewBag.CanModify = true;
        ViewBag.LocalMode = true;
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

    [HttpGet]
    public async Task<IActionResult> DataSources(int id, CancellationToken ct)
    {
        if (!await _tasks.CanViewAsync(UserId, id, ct))
            return Forbid();
        return Json(await _dataSources.ListForTaskAsync(UserId, id, ct));
    }

    [HttpPost]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken]
    [RequestSizeLimit(20_000_000)]
    public IActionResult ParseExcel(IFormFile file, string? title = null)
    {
        // Local-first: parse only — sources attach to process properties in the browser.
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "فایل اکسل لازم است." });
        var name = file.FileName ?? "";
        if (!name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
            && !name.EndsWith(".xlsm", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "فقط فایل .xlsx پشتیبانی می‌شود." });

        try
        {
            using var stream = file.OpenReadStream();
            var suggested = string.IsNullOrWhiteSpace(title)
                ? Path.GetFileNameWithoutExtension(name)
                : title;
            return Json(_dataSources.ParseExcelOnly(stream, suggested));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost]
    [IgnoreAntiforgeryToken]
    [RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> UploadDataSource(int id, IFormFile file, string? title, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "فایل اکسل لازم است." });
        var name = file.FileName ?? "";
        if (!name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
            && !name.EndsWith(".xlsm", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "فقط فایل .xlsx پشتیبانی می‌شود." });

        try
        {
            await using var stream = file.OpenReadStream();
            var result = await _dataSources.UploadExcelAsync(
                UserId, id, title ?? Path.GetFileNameWithoutExtension(name), stream, ct);
            return Json(result);
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost]
    [IgnoreAntiforgeryToken]
    public async Task<IActionResult> DeleteDataSource(int id, int sourceId, CancellationToken ct)
    {
        try
        {
            var ok = await _dataSources.DeleteAsync(UserId, sourceId, ct);
            return ok ? Ok(new { ok = true }) : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [HttpGet]
    public async Task<IActionResult> DataSourceDetail(int id, int sourceId, CancellationToken ct)
    {
        if (!await _tasks.CanViewAsync(UserId, id, ct))
            return Forbid();
        var dto = await _dataSources.GetAsync(UserId, sourceId, ct);
        return dto is null ? NotFound() : Json(dto);
    }
}
