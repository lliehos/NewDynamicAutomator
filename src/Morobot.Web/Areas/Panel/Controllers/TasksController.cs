using System.Security.Claims;
using Morobot.Contracts.DataSources;
using Morobot.Infrastructure.Services;
using Morobot.Web.Hubs;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Areas.Panel.Controllers;

[Area("Panel")]
[Authorize]
public class TasksController : Controller
{
    private readonly TaskService _tasks;
    private readonly DataSourceService _dataSources;
    private readonly IHubContext<PlayDataHub> _playHub;
    private readonly PlaySessionTracker _plays;
    private readonly CatalogLiveService _catalog;

    public TasksController(
        TaskService tasks,
        DataSourceService dataSources,
        IHubContext<PlayDataHub> playHub,
        PlaySessionTracker plays,
        CatalogLiveService catalog)
    {
        _tasks = tasks;
        _dataSources = dataSources;
        _playHub = playHub;
        _plays = plays;
        _catalog = catalog;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult Create(string title)
    {
        if (string.IsNullOrWhiteSpace(title))
            return RedirectToAction("Index", "Home", new { area = "Panel" });
        return RedirectToAction("Index", "Home", new { area = "Panel" });
    }

    [HttpGet]
    public IActionResult Editor(string id)
    {
        ViewBag.TaskId = id ?? "";
        ViewBag.CanModify = true;
        ViewBag.LocalMode = false;
        ViewBag.EntitlementsJson = System.Text.Json.JsonSerializer.Serialize(
            EntitlementService.FromClaims(User),
            new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
        return View();
    }

    [HttpGet]
    public Task<IActionResult> Graph(int id, CancellationToken ct)
        => RedirectToCanvasJson(id, ct);

    private async Task<IActionResult> RedirectToCanvasJson(int id, CancellationToken ct)
    {
        var hit = await _tasks.GetCanvasAsync(UserId, id, ct);
        if (hit is null) return NotFound();
        var (json, _) = hit.Value;
        if (string.IsNullOrWhiteSpace(json))
            return Json(new { taskId = id, nodes = Array.Empty<object>(), edges = Array.Empty<object>(), dataSources = Array.Empty<object>() });
        return Content(json, "application/json");
    }

    [HttpPost]
    [IgnoreAntiforgeryToken]
    public IActionResult SaveGraph(int id) =>
        StatusCode(StatusCodes.Status410Gone, new { message = "Use PUT /api/tasks/{id}/canvas", code = "gone" });

    [HttpGet]
    public IActionResult DataSources(int id) =>
        StatusCode(StatusCodes.Status410Gone, new { message = "Sources live in canvas JSON.", code = "gone" });

    [HttpPost]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken]
    [RequestSizeLimit(20_000_000)]
    public IActionResult ParseExcel(IFormFile file)
    {
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
        if (string.IsNullOrWhiteSpace(ev.UserName))
            ev.UserName = User.Identity?.IsAuthenticated == true ? User.Identity.Name : ev.UserName;

        await _playHub.Clients
            .Group(PlayDataHub.TaskGroup(ev.TaskId))
            .SendAsync("cellEvent", ev, ct);

        return Ok(new { ok = true });
    }

    [HttpPost]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken]
    public async Task<IActionResult> RegisterPlay([FromBody] PlayRegisterDto? body, CancellationToken ct)
    {
        var taskId = (body?.TaskId ?? "").Trim();
        if (string.IsNullOrEmpty(taskId)) return BadRequest();
        var userName = body?.UserName
            ?? (User.Identity?.IsAuthenticated == true ? User.Identity.Name : null);
        int? uid = null;
        if (User.Identity?.IsAuthenticated == true
            && int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var parsedUid))
            uid = parsedUid;
        _plays.Register(taskId, userName, uid, null);
        await _playHub.Clients.Group(PlayDataHub.TaskGroup(taskId)).SendAsync("playState", new
        {
            taskId,
            playing = true,
            userName
        }, ct);
        await _catalog.NotifyPlayStateAsync(taskId, true, userName, ct);
        return Ok(new { ok = true });
    }

    [HttpPost]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken]
    public async Task<IActionResult> UnregisterPlay([FromBody] PlayRegisterDto? body, CancellationToken ct)
    {
        var taskId = (body?.TaskId ?? "").Trim();
        if (string.IsNullOrEmpty(taskId)) return BadRequest();
        _plays.Unregister(taskId);
        await _playHub.Clients.Group(PlayDataHub.TaskGroup(taskId)).SendAsync("playState", new
        {
            taskId,
            playing = false
        }, ct);
        await _catalog.NotifyPlayStateAsync(taskId, false, null, ct);
        return Ok(new { ok = true });
    }

    [HttpGet]
    [AllowAnonymous]
    public IActionResult PlayAbort(string taskId)
    {
        taskId = (taskId ?? "").Trim();
        if (string.IsNullOrEmpty(taskId)) return BadRequest();
        var abort = _plays.PeekAbort(taskId);
        if (abort) _plays.ConsumeAbort(taskId);
        return Ok(new { abort, playing = _plays.IsPlaying(taskId) });
    }

    [HttpPost]
    [IgnoreAntiforgeryToken]
    public IActionResult UploadDataSource(int id) =>
        StatusCode(StatusCodes.Status410Gone, new { message = "Use editor canvas upload.", code = "gone" });

    [HttpPost]
    [IgnoreAntiforgeryToken]
    public IActionResult DeleteDataSource(int id, int sourceId) =>
        StatusCode(StatusCodes.Status410Gone, new { message = "Use editor canvas.", code = "gone" });

    [HttpGet]
    public IActionResult DataSourceDetail(int id, int sourceId) =>
        StatusCode(StatusCodes.Status410Gone, new { message = "Use editor canvas.", code = "gone" });
}

public class PlayRegisterDto
{
    public string? TaskId { get; set; }
    public string? UserName { get; set; }
}
