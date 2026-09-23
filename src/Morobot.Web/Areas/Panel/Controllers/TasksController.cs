using System.Security.Claims;
using Morobot.Contracts.DataSources;
using Morobot.Contracts.Tasks;
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
    private readonly GraphService _graph;
    private readonly DataSourceService _dataSources;
    private readonly IHubContext<PlayDataHub> _playHub;
    private readonly PlaySessionTracker _plays;

    public TasksController(
        TaskService tasks,
        GraphService graph,
        DataSourceService dataSources,
        IHubContext<PlayDataHub> playHub,
        PlaySessionTracker plays)
    {
        _tasks = tasks;
        _graph = graph;
        _dataSources = dataSources;
        _playHub = playHub;
        _plays = plays;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private bool IsLocalSession =>
        User.FindFirstValue(EntitlementService.ClaimIsLocal) == "1"
        || string.Equals(User.FindFirstValue(EntitlementService.ClaimPlan), "Local", StringComparison.OrdinalIgnoreCase);

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
        // Server is source of truth for all tiers (anti-bypass). localStorage is cache only.
        ViewBag.LocalMode = false;
        ViewBag.EntitlementsJson = System.Text.Json.JsonSerializer.Serialize(
            EntitlementService.FromClaims(User),
            new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
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

public class PlayRegisterDto
{
    public string? TaskId { get; set; }
    public string? UserName { get; set; }
}
