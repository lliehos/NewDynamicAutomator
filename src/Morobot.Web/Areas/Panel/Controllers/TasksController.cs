using System.Security.Claims;
using Morobot.Contracts.DataSources;
using Morobot.Contracts.Tasks;
using Morobot.Infrastructure.Services;
using Morobot.Web.Hubs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Areas.Panel.Controllers;

[Area("Panel")]
[Authorize]
public class TasksController : Controller
{
    private readonly TaskService _tasks;
    private readonly GraphService _graph;
    private readonly DataSourceService _dataSources;
    private readonly IHubContext<PlayDataHub> _playHub;

    public TasksController(
        TaskService tasks,
        GraphService graph,
        DataSourceService dataSources,
        IHubContext<PlayDataHub> playHub)
    {
        _tasks = tasks;
        _graph = graph;
        _dataSources = dataSources;
        _playHub = playHub;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult Create(string title)
    {
        // Local-first: manual create happens in browser JS; this is a fallback redirect shell.
        if (string.IsNullOrWhiteSpace(title))
            return RedirectToAction("Index", "Home", new { area = "Panel" });
        return RedirectToAction("Index", "Home", new { area = "Panel" });
    }

    [HttpGet]
    public IActionResult Editor(string id)
    {
        // Local-first: graph lives in localStorage; no DB permission check.
        // Process ids are unique strings (UUID) scoped with owner user for future server keys.
        ViewBag.TaskId = id ?? "";
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
    public IActionResult ParseExcel(IFormFile file)
    {
        // Local-first: parse only — sources attach to process properties in the browser.
        // Title is always the uploaded file name (no separate title field).
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "فایل اکسل لازم است." });
        var name = file.FileName ?? "";
        if (!name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
            && !name.EndsWith(".xlsm", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "فقط فایل .xlsx پشتیبانی می‌شود." });

        try
        {
            using var stream = file.OpenReadStream();
            var suggested = Path.GetFileNameWithoutExtension(name);
            return Json(_dataSources.ParseExcelOnly(stream, suggested));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken]
    [RequestSizeLimit(40_000_000)]
    public IActionResult ExportExcel([FromBody] ExportExcelRequest? request)
    {
        if (request is null)
            return BadRequest(new { message = "دادهٔ منبع لازم است." });

        try
        {
            var columns = request.Columns ?? new List<DataSourceColumnDto>();
            if (columns.Count == 0 && request.ColumnKeys is { Count: > 0 })
            {
                columns = request.ColumnKeys
                    .Where(k => !string.IsNullOrWhiteSpace(k))
                    .Select(k => new DataSourceColumnDto { Key = k, Title = k })
                    .ToList();
            }

            var bytes = _dataSources.BuildExcel(columns, request.Cells ?? new List<DataSourceCellDto>());
            var baseName = string.IsNullOrWhiteSpace(request.Title) ? "data-source" : request.Title.Trim();
            foreach (var ch in Path.GetInvalidFileNameChars())
                baseName = baseName.Replace(ch, '_');
            if (!baseName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
                baseName += ".xlsx";

            return File(
                bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                baseName);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// Player posts cell read/write events; editor viewers subscribed via SignalR receive them live.
    /// </summary>
    [HttpPost]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken]
    public async Task<IActionResult> NotifyCellEvent([FromBody] DataSourceCellEventDto? ev, CancellationToken ct)
    {
        if (ev is null || string.IsNullOrWhiteSpace(ev.TaskId) || ev.DataSourceId == 0 || string.IsNullOrWhiteSpace(ev.ColumnKey))
            return BadRequest(new { message = "رویداد سلول ناقص است." });

        var op = string.IsNullOrWhiteSpace(ev.Op) ? "read" : ev.Op.Trim().ToLowerInvariant();
        if (op != "read" && op != "write") op = "read";
        ev.Op = op;
        ev.TaskId = ev.TaskId.Trim();
        ev.ColumnKey = ev.ColumnKey.Trim();

        await _playHub.Clients
            .Group(PlayDataHub.TaskGroup(ev.TaskId))
            .SendAsync("cellEvent", ev, ct);

        return Ok(new { ok = true });
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
