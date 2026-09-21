using System.Security.Claims;
using DynamicAutomator.Contracts.Tasks;
using DynamicAutomator.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/tasks")]
public class TasksController : ControllerBase
{
    private readonly TaskService _tasks;
    private readonly GraphService _graph;

    public TasksController(TaskService tasks, GraphService graph)
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
            CanModify = true
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
