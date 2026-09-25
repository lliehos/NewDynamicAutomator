using System.Security.Claims;
using Morobot.Contracts.Tasks;
using Morobot.Domain.Entities;
using Morobot.Infrastructure.Services;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Controllers.Api;

/// <summary>
/// JSON API for process templates ("قالب‌ها") — the reusable skeletons a process can be built from
/// and keep inheriting changes from.
/// </summary>
/// <remarks>
/// Separate from <see cref="TasksApiController"/> because the two answer different questions: that
/// one is about a process a user owns, this one is about the shared skeleton underneath it. A
/// process created from a template comes back in the same shape as the processes list, so the
/// caller can insert it without a second round trip — the shape is defined there, not re-invented
/// here.
/// </remarks>
[ApiController]
[Authorize]
[Route("api/templates")]
public class TemplatesApiController : ControllerBase
{
    private readonly TemplateService _templates;
    private readonly TaskService _tasks;
    private readonly EntitlementService _entitlements;
    private readonly EventLogService _events;
    private readonly CatalogLiveService _catalog;

    public TemplatesApiController(
        TemplateService templates,
        TaskService tasks,
        EntitlementService entitlements,
        EventLogService events,
        CatalogLiveService catalog)
    {
        _templates = templates;
        _tasks = tasks;
        _entitlements = entitlements;
        _events = events;
        _catalog = catalog;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    /// <summary>
    /// True when the caller may shape the shared templates: an administrator, or the
    /// <see cref="Morobot.Domain.Enums.UserRole.ProcessManager"/> role created for exactly this.
    /// </summary>
    private bool CanManage =>
        User.IsInRole(nameof(Morobot.Domain.Enums.UserRole.Admin))
        || User.IsInRole(nameof(Morobot.Domain.Enums.UserRole.ProcessManager));

    /// <summary>The templates a user may pick when creating a process.</summary>
    [HttpGet]
    public async Task<ActionResult<List<ProcessTemplateDto>>> List(CancellationToken ct)
    {
        var list = await _templates.ListAsync(includeInactive: false, ct);
        // Stamped here rather than in the service: "may this caller manage templates" is a fact
        // about the request's identity, which the service does not see.
        foreach (var item in list) item.CanManage = CanManage;
        return Ok(list);
    }

    /// <summary>
    /// Every template including the retired ones, for the management page. Returned to managers
    /// only: a retired template is still someone's decision, not something to show everyone.
    /// </summary>
    [HttpGet("all")]
    public async Task<ActionResult<List<ProcessTemplateDto>>> ListAll(CancellationToken ct)
    {
        if (!CanManage) return Forbid();
        var list = await _templates.ListAsync(includeInactive: true, ct);
        foreach (var item in list) item.CanManage = true;
        return Ok(list);
    }

    private static readonly Dictionary<string, string> TemplateErrorMessages = new()
    {
        ["template.titleRequired"] = "عنوان قالب لازم است.",
        ["template.processNotFound"] = "فرآیند یافت نشد.",
        ["template.processAlreadyFromTemplate"] = "این فرآیند خودش از یک قالب ساخته شده است.",
        ["template.notFound"] = "قالب یافت نشد.",
        ["template.inactive"] = "این قالب غیرفعال است.",
        ["template.notAttached"] = "این فرآیند به هیچ قالبی متصل نیست."
    };

    private ObjectResult TemplateError(string code) =>
        BadRequest(new { message = TemplateErrorMessages.GetValueOrDefault(code, code), code });

    /// <summary>
    /// Create a template from a process the user owns, and attach that process to the new template
    /// so the author keeps editing in one place.
    /// </summary>
    [HttpPost("from-process/{processId:int}")]
    public async Task<ActionResult<ProcessTemplateDto>> CreateFromProcess(
        int processId, [FromBody] SaveTemplateRequest request, CancellationToken ct)
    {
        // Publishing a template changes what other people's processes run, so it is a manager's
        // act rather than any editor's. Ownership of the process is checked as well: a manager
        // still may not turn someone else's private process into a shared skeleton.
        if (!CanManage) return Forbid();
        if (!await _tasks.CanEditAsync(UserId, processId, ct)) return Forbid();

        var (ok, error, template) = await _templates.CreateFromProcessAsync(UserId, processId, request, ct);
        if (!ok || template is null) return TemplateError(error ?? "template.notFound");

        await _events.LogAsync(
            "Audit", "Template", "TemplateCreate",
            $"Created template #{template.Id}: {template.Title} from process #{processId}",
            UserId, User.Identity?.Name,
            path: $"/api/templates/from-process/{processId}",
            ct: ct);

        var dto = (await _templates.ListAsync(includeInactive: true, ct)).FirstOrDefault(t => t.Id == template.Id);
        return Ok(dto);
    }

    /// <summary>Publish an edit to a template and, by default, push it to the attached processes.</summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateTemplateRequest request, CancellationToken ct)
    {
        if (!CanManage) return Forbid();

        var (ok, error, pushed) = await _templates.UpdateAsync(
            UserId, id, new SaveTemplateRequest
            {
                Title = request.Title,
                Description = request.Description,
                PushToAttached = request.PushToAttached
            },
            request.GraphJson, ct);

        if (!ok) return TemplateError(error ?? "template.notFound");

        await _events.LogAsync(
            "Audit", "Template", "TemplateUpdate",
            $"Updated template #{id}; pushed to {pushed} process(es)",
            UserId, User.Identity?.Name,
            path: $"/api/templates/{id}",
            ct: ct);

        return Ok(new { ok = true, pushedToProcesses = pushed });
    }

    /// <summary>
    /// Create a process from a template. The template's linked sources are deliberately not copied:
    /// two processes made from one template are meant to run on different spreadsheets.
    /// </summary>
    [HttpPost("{id:int}/create-process")]
    public async Task<ActionResult<TaskListItemDto>> CreateProcess(
        int id, [FromBody] CreateFromTemplateRequest request, CancellationToken ct)
    {
        var entitlements = await _entitlements.ResolveWithCountsAsync(UserId, User, ct);
        try
        {
            var (ok, error, process) = await _templates.CreateProcessAsync(UserId, id, request, ct);
            if (!ok || process is null) return TemplateError(error ?? "template.notFound");

            await _events.LogAsync(
                "Audit", "Task", "TaskCreateFromTemplate",
                $"Created task #{process.Id}: {process.Title} from template #{id}",
                UserId, User.Identity?.Name,
                path: $"/api/templates/{id}/create-process",
                ct: ct);

            // Re-read through the normal list query so the row carries the same permissions and
            // template flags any other list row does, instead of a hand-built half-shape.
            var dto = (await _tasks.ListForUserAsync(UserId, ct)).FirstOrDefault(t => t.Id == process.Id);
            if (dto is null) return Ok(new { id = process.Id, title = process.Title });

            await _catalog.TaskUpsertedAsync(dto, "created", User.Identity?.Name, ct);
            return Ok(dto);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message, code = "limit" });
        }
    }

    /// <summary>Detach a process from its template; the process keeps today's graph and stops tracking.</summary>
    [HttpPost("{id:int}/detach/{processId:int}")]
    public async Task<IActionResult> Detach(int id, int processId, CancellationToken ct)
    {
        if (!await _tasks.CanEditAsync(UserId, processId, ct)) return Forbid();

        var (ok, error) = await _templates.DetachAsync(UserId, processId, ct);
        if (!ok) return TemplateError(error ?? "template.processNotFound");

        await _events.LogAsync(
            "Audit", "Template", "TemplateDetach",
            $"Detached process #{processId} from template #{id}",
            UserId, User.Identity?.Name,
            path: $"/api/templates/{id}/detach/{processId}",
            ct: ct);

        var dto = (await _tasks.ListForUserAsync(UserId, ct)).FirstOrDefault(t => t.Id == processId);
        if (dto is not null) await _catalog.TaskUpsertedAsync(dto, "updated", User.Identity?.Name, ct);
        return Ok(new { ok = true, task = dto });
    }

    /// <summary>Pull the template's current graph into one attached process without detaching it.</summary>
    [HttpPost("{id:int}/pull/{processId:int}")]
    public async Task<IActionResult> Pull(int id, int processId, CancellationToken ct)
    {
        if (!await _tasks.CanEditAsync(UserId, processId, ct)) return Forbid();

        var (ok, error) = await _templates.PullLatestAsync(UserId, processId, ct);
        if (!ok) return TemplateError(error ?? "template.processNotFound");

        await _events.LogAsync(
            "Audit", "Template", "TemplatePull",
            $"Pulled template #{id} into process #{processId}",
            UserId, User.Identity?.Name,
            path: $"/api/templates/{id}/pull/{processId}",
            ct: ct);

        var dto = (await _tasks.ListForUserAsync(UserId, ct)).FirstOrDefault(t => t.Id == processId);
        if (dto is not null) await _catalog.TaskUpsertedAsync(dto, "updated", User.Identity?.Name, ct);
        return Ok(new { ok = true, task = dto });
    }
}

/// <summary>Publish request for one template; the graph is optional so a rename needs no graph.</summary>
public class UpdateTemplateRequest
{
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    /// <summary>New graph to publish. Null leaves the stored graph as it is (a title-only edit).</summary>
    public string? GraphJson { get; set; }
    public bool PushToAttached { get; set; } = true;
}
