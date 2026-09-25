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
    private readonly EntitlementService _entitlements;
    private readonly DiagramSettingsService _diagram;

    public TasksController(
        TaskService tasks,
        DataSourceService dataSources,
        IHubContext<PlayDataHub> playHub,
        PlaySessionTracker plays,
        CatalogLiveService catalog,
        EntitlementService entitlements,
        DiagramSettingsService diagram)
    {
        _tasks = tasks;
        _dataSources = dataSources;
        _playHub = playHub;
        _plays = plays;
        _catalog = catalog;
        _diagram = diagram;
        _entitlements = entitlements;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    /// <summary>
    /// Build an ASCII-safe fallback for the Content-Disposition <c>filename</c> parameter.
    ///
    /// The real name travels in <c>filename*</c> (RFC 5987, UTF-8) and every current browser
    /// prefers it. Some older clients only look at the plain <c>filename</c>, and ASP.NET Core
    /// replaces non-ASCII with escapes that a few of them render as '?' or blanks. Rather than
    /// let the name become unreadable there, keep ASCII letters/digits, turn spaces into '_'
    /// and drop everything else, so such a client at least gets a stable, legible file name
    /// instead of a row of '?'.
    /// </summary>
    private static string AsciiDownloadFallback(string name)
    {
        var sb = new System.Text.StringBuilder(name.Length);
        foreach (var ch in name)
        {
            if (ch < 128 && char.IsLetterOrDigit(ch)) sb.Append(ch);
            else if (ch is '_' or '-' or '.') sb.Append(ch);
            else if (ch == ' ') sb.Append('_');
        }
        var trimmed = sb.ToString().Trim('_', '.', '-');
        return string.IsNullOrEmpty(trimmed) ? "data-source" : trimmed;
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult Create(string title)
    {
        if (string.IsNullOrWhiteSpace(title))
            return RedirectToAction("Index", "Home", new { area = "Panel" });
        return RedirectToAction("Index", "Home", new { area = "Panel" });
    }

    [HttpGet]
    public async Task<IActionResult> Editor(string id, CancellationToken ct = default)
    {
        ViewBag.TaskId = id ?? "";
        ViewBag.CanModify = true;
        ViewBag.LocalMode = false;
        ViewBag.EntitlementsJson = System.Text.Json.JsonSerializer.Serialize(
            EntitlementService.FromClaims(User),
            new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
        // Diagram defaults come from Admin → Settings so an admin can change how every new
        // process looks without a code change. Property names are already lower-camel in the DTO.
        ViewBag.DiagramDefaultsJson = System.Text.Json.JsonSerializer.Serialize(
            await _diagram.GetAsync(ct));
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
    [IgnoreAntiforgeryToken]
    [RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> ParseExcel(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "فایل اکسل لازم است." });
        var name = file.FileName ?? "";
        if (!name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
            && !name.EndsWith(".xlsm", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "فقط فایل .xlsx پشتیبانی می‌شود." });

        try
        {
            var entitlements = await _entitlements.ResolveWithCountsAsync(UserId, User, ct);
            await _entitlements.EnsureCanCreateDataSourceAsync(UserId, entitlements, ct);
            using var stream = file.OpenReadStream();
            var suggested = Path.GetFileNameWithoutExtension(name);
            return Json(_dataSources.ParseExcelOnly(stream, suggested));
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("limit", StringComparison.OrdinalIgnoreCase))
        {
            var entitlements = await _entitlements.ResolveWithCountsAsync(UserId, User, ct);
            return BadRequest(new
            {
                message = ex.Message,
                code = "limit",
                max = entitlements.MaxDataSources
            });
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
            // The download name is the source's own name, not the file it was imported from.
            var baseName = string.IsNullOrWhiteSpace(request.Title) ? "data-source" : request.Title.Trim();
            foreach (var ch in Path.GetInvalidFileNameChars())
                baseName = baseName.Replace(ch, '_');
            if (!baseName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
                baseName += ".xlsx";

            // Send the real (possibly Persian) name in filename* and keep a plain ASCII
            // fallback in filename so clients that ignore RFC 5987 still get a usable name.
            var cd = new Microsoft.Net.Http.Headers.ContentDispositionHeaderValue("attachment")
            {
                FileName = AsciiDownloadFallback(baseName),
                FileNameStar = baseName
            };
            Response.Headers.ContentDisposition = cd.ToString();

            return File(
                bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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
