using System.Security.Claims;
using DynamicAutomator.Contracts.Auth;
using DynamicAutomator.Contracts.DataSources;
using DynamicAutomator.Contracts.Recordings;
using DynamicAutomator.Contracts.Tasks;
using DynamicAutomator.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Controllers.Api;

/// <summary>
/// JSON API for the Chrome extension and portal AJAX — hosted on the Web app (no separate API process).
/// </summary>
[ApiController]
[Authorize]
[Route("api/tasks")]
public class TasksApiController : ControllerBase
{
    private readonly TaskService _tasks;
    private readonly GraphService _graph;

    public TasksApiController(TaskService tasks, GraphService graph)
    {
        _tasks = tasks;
        _graph = graph;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<TaskListItemDto>>> List(CancellationToken ct)
        => Ok(await _tasks.ListForUserAsync(UserId, ct));

    [HttpPost]
    public async Task<ActionResult<TaskListItemDto>> Create([FromBody] CreateTaskRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { message = "عنوان فرآیند لازم است." });

        var task = await _tasks.CreateAsync(UserId, request, ct);
        return Ok(new TaskListItemDto
        {
            Id = task.Id,
            Title = task.Title,
            CreatedAtUtc = task.CreatedAtUtc,
            CanModify = true,
            DesignOrigin = task.DesignOrigin.ToString()
        });
    }

    [HttpGet("{id:int}/graph")]
    public async Task<ActionResult<TaskGraphDto>> Graph(int id, CancellationToken ct)
    {
        var graph = await _graph.GetAsync(UserId, id, ct);
        return graph is null ? NotFound() : Ok(graph);
    }

    [HttpPut("{id:int}/graph")]
    public async Task<ActionResult<TaskGraphDto>> SaveGraph(int id, [FromBody] SaveTaskGraphRequest request, CancellationToken ct)
    {
        try
        {
            return Ok(await _graph.SaveAsync(UserId, id, request, ct));
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }
}

[ApiController]
[Authorize]
[Route("api/recordings")]
public class RecordingsApiController : ControllerBase
{
    private readonly RecordingService _recordings;

    public RecordingsApiController(RecordingService recordings) => _recordings = recordings;

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    public async Task<ActionResult<SaveRecordingResponse>> Save([FromBody] SaveRecordingRequest request, CancellationToken ct)
    {
        if (request.Actions.Count == 0)
            return BadRequest(new { message = "هیچ اکشنی برای ذخیره نیست." });

        try
        {
            return Ok(await _recordings.SaveAsync(UserId, request, ct));
        }
        catch (UnauthorizedAccessException ex)
        {
            return Forbid(ex.Message);
        }
    }
}

[ApiController]
[Authorize]
[Route("api/tasks/{taskId:int}/datasources")]
public class TaskDataSourcesApiController : ControllerBase
{
    private readonly DataSourceService _sources;

    public TaskDataSourcesApiController(DataSourceService sources) => _sources = sources;

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<DataSourceListItemDto>>> List(int taskId, CancellationToken ct)
        => Ok(await _sources.ListForTaskAsync(UserId, taskId, ct));

    [HttpPost("upload")]
    [RequestSizeLimit(20_000_000)]
    public async Task<ActionResult<UploadDataSourceResponse>> Upload(
        int taskId,
        IFormFile file,
        [FromForm] string? title,
        CancellationToken ct)
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
            var result = await _sources.UploadExcelAsync(
                UserId, taskId, title ?? Path.GetFileNameWithoutExtension(name), stream, ct);
            return Ok(result);
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
}

[ApiController]
[Authorize]
[Route("api/datasources")]
public class DataSourcesApiController : ControllerBase
{
    private readonly DataSourceService _sources;

    public DataSourcesApiController(DataSourceService sources) => _sources = sources;

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<DataSourceDetailDto>> Get(int id, CancellationToken ct)
    {
        var dto = await _sources.GetAsync(UserId, id, ct);
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        try
        {
            var ok = await _sources.DeleteAsync(UserId, id, ct);
            return ok ? NoContent() : NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }
}
