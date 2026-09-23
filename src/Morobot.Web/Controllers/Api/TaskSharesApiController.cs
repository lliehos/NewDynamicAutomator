using System.Security.Claims;
using Morobot.Contracts.Tasks;
using Morobot.Infrastructure.Services;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Controllers.Api;

[ApiController]
[Authorize]
[Route("api")]
public class TaskSharesApiController : ControllerBase
{
    private readonly TaskShareService _shares;
    private readonly TaskService _tasks;
    private readonly CatalogLiveService _catalog;

    public TaskSharesApiController(TaskShareService shares, TaskService tasks, CatalogLiveService catalog)
    {
        _shares = shares;
        _tasks = tasks;
        _catalog = catalog;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("users/search")]
    public async Task<ActionResult<List<UserSearchHitDto>>> SearchUsers([FromQuery] string? q, CancellationToken ct)
        => Ok(await _shares.SearchUsersAsync(UserId, q, 20, ct));

    [HttpGet("tasks/{id:int}/shares")]
    public async Task<ActionResult<List<TaskShareDto>>> List(int id, CancellationToken ct)
    {
        var (list, error) = await _shares.ListSharesAsync(UserId, id, ct);
        if (error == "forbidden") return Forbid();
        return Ok(list ?? new List<TaskShareDto>());
    }

    [HttpPost("tasks/{id:int}/shares")]
    public async Task<ActionResult<TaskShareDto>> Upsert(int id, [FromBody] UpsertTaskShareRequest req, CancellationToken ct)
    {
        var (dto, error) = await _shares.UpsertShareAsync(UserId, id, req, ct);
        if (error == "forbidden") return Forbid();
        if (error == "notfound" || error == "user_not_found") return NotFound(new { code = error });
        if (dto is null) return BadRequest(new { code = error, message = error });

        var list = await _tasks.ListForUserAsync(UserId, ct);
        var item = list.FirstOrDefault(x => x.Id == id);
        if (item != null)
            await _catalog.TaskUpsertedAsync(item, "shared", User.Identity?.Name, ct);

        return Ok(dto);
    }

    [HttpDelete("tasks/{id:int}/shares/{userId:int}")]
    public async Task<IActionResult> Revoke(int id, int userId, CancellationToken ct)
    {
        var (ok, error) = await _shares.RevokeShareAsync(UserId, id, userId, ct);
        if (error == "forbidden") return Forbid();
        if (!ok) return BadRequest(new { code = error });

        // Revoked user loses the process from their catalog.
        await _catalog.TaskDeletedAsync(id, new[] { userId }, User.Identity?.Name, ct);

        var list = await _tasks.ListForUserAsync(UserId, ct);
        var item = list.FirstOrDefault(x => x.Id == id);
        if (item != null)
            await _catalog.TaskUpsertedAsync(item, "shared", User.Identity?.Name, ct);

        return NoContent();
    }
}
