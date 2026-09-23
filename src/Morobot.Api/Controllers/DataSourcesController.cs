using System.Security.Claims;
using Morobot.Contracts.DataSources;
using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/tasks/{taskId:int}/datasources")]
public class DataSourcesController : ControllerBase
{
    private readonly DataSourceService _sources;

    public DataSourcesController(DataSourceService sources) => _sources = sources;

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
            var result = await _sources.UploadExcelAsync(UserId, taskId, title ?? Path.GetFileNameWithoutExtension(name), stream, ct);
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
public class DataSourceItemController : ControllerBase
{
    private readonly DataSourceService _sources;

    public DataSourceItemController(DataSourceService sources) => _sources = sources;

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
