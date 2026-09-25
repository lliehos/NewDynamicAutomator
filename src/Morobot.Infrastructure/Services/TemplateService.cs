using Morobot.Contracts.Tasks;
using Morobot.Domain.Entities;
using Morobot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Services;

/// <summary>
/// Templates: reusable process skeletons that attached processes inherit changes from.
/// </summary>
/// <remarks>
/// The rules this service exists to enforce, because they are easy to get wrong in a controller:
///
/// <list type="bullet">
/// <item><b>Sources are never inherited.</b> Creating a process from a template copies the graph
/// but not the <see cref="ProcessDataSource"/> links, and publishing a template updates the
/// attached processes' graphs without touching their links. Two processes made from one template
/// are expected to run on different spreadsheets — copying the links over would silently point
/// them at the template author's data.</item>
/// <item><b>Attached processes follow the template.</b> Publishing bumps the version and writes
/// the new graph into every attached process, then records the version each one now carries, so a
/// process that is edited elsewhere can still be detected as behind.</item>
/// <item><b>Detaching is explicit.</b> A detached process keeps the graph it had at that moment
/// and stops tracking the template; there is no implicit re-attach.</item>
/// <item><b>A process cannot edit a template's structure by accident.</b> <see cref="CanEditGraphAsync"/>
/// tells the editor whether a save should go to the process or to its template.</item>
/// </list>
/// </remarks>
public class TemplateService
{
    private readonly AppDbContext _db;
    private readonly EntitlementService _entitlements;

    public TemplateService(AppDbContext db, EntitlementService entitlements)
    {
        _db = db;
        _entitlements = entitlements;
    }

    /// <summary>
    /// The templates a user may pick from when creating a process: every active template, newest
    /// first. Templates are shared infrastructure rather than private rows — a template is only
    /// useful when the whole team builds on the same one — so this is not filtered by owner.
    /// </summary>
    public async Task<List<ProcessTemplateDto>> ListAsync(bool includeInactive = false, CancellationToken ct = default)
    {
        var query = _db.ProcessTemplates.AsNoTracking();
        if (!includeInactive) query = query.Where(t => t.IsActive);

        var rows = await query
            .OrderByDescending(t => t.UpdatedAtUtc)
            .Select(t => new
            {
                t.Id,
                t.Title,
                t.Description,
                t.Version,
                t.UpdatedAtUtc,
                CreatorUserName = t.Creator != null ? t.Creator.UserName : null,
                t.GraphJson,
                AttachedProcessCount = t.Processes.Count,
                t.IsActive
            })
            .ToListAsync(ct);

        return rows.Select(t =>
        {
            var (groups, steps) = GraphJsonHelper.CountNodes(t.GraphJson);
            return new ProcessTemplateDto
            {
                Id = t.Id,
                Title = t.Title,
                Description = t.Description,
                Version = t.Version,
                UpdatedAtUtc = t.UpdatedAtUtc,
                CreatorUserName = t.CreatorUserName,
                AttachedProcessCount = t.AttachedProcessCount,
                GroupCount = groups,
                StepCount = steps
            };
        }).ToList();
    }

    public async Task<ProcessTemplate?> GetAsync(int templateId, CancellationToken ct = default)
        => await _db.ProcessTemplates.FirstOrDefaultAsync(t => t.Id == templateId, ct);

    /// <summary>
    /// Turn an existing process into a template. The process is left attached to the template it
    /// produced, so the author can keep editing one place and have the change reach the process
    /// they started from — otherwise creating a template from a process would immediately fork it.
    /// </summary>
    public async Task<(bool ok, string? error, ProcessTemplate? template)> CreateFromProcessAsync(
        int userId, int processId, SaveTemplateRequest request, CancellationToken ct = default)
    {
        var title = request.Title?.Trim();
        if (string.IsNullOrWhiteSpace(title))
            return (false, "template.titleRequired", null);

        var process = await _db.Processes.FirstOrDefaultAsync(p => p.Id == processId, ct);
        if (process is null) return (false, "template.processNotFound", null);

        if (process.TemplateId is not null)
            return (false, "template.processAlreadyFromTemplate", null);

        var template = new ProcessTemplate
        {
            Title = title,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            // The editor writes the envelope; keep it verbatim so a template round-trips the same
            // shape the process had, and a reader that expects either shape keeps working.
            GraphJson = process.GraphJson,
            Version = 1,
            IsActive = true,
            CreatorUserId = userId > 0 ? userId : null,
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow
        };
        _db.ProcessTemplates.Add(template);
        await _db.SaveChangesAsync(ct);

        process.TemplateId = template.Id;
        process.TemplateVersion = template.Version;
        process.UpdatedAtUtc = DateTime.UtcNow;
        process.LastEditorUserId = userId > 0 ? userId : null;
        await _db.SaveChangesAsync(ct);

        return (true, null, template);
    }

    /// <summary>
    /// Publish an edit to a template. When <see cref="SaveTemplateRequest.PushToAttached"/> is set
    /// the new graph is written into every process still attached, and each one's recorded version
    /// is brought up to date.
    /// </summary>
    public async Task<(bool ok, string? error, int pushed)> UpdateAsync(
        int userId, int templateId, SaveTemplateRequest request, string? newGraphJson, CancellationToken ct = default)
    {
        var template = await _db.ProcessTemplates.FirstOrDefaultAsync(t => t.Id == templateId, ct);
        if (template is null) return (false, "template.notFound", 0);

        var title = request.Title?.Trim();
        if (string.IsNullOrWhiteSpace(title)) return (false, "template.titleRequired", 0);

        template.Title = title;
        template.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        if (newGraphJson is not null) template.GraphJson = newGraphJson;
        template.Version += 1;
        template.UpdatedAtUtc = DateTime.UtcNow;

        var pushed = 0;
        if (request.PushToAttached && newGraphJson is not null)
        {
            var attached = await _db.Processes.Where(p => p.TemplateId == templateId).ToListAsync(ct);
            foreach (var p in attached)
            {
                // Only the graph moves across. Source links stay with the process by design.
                p.GraphJson = newGraphJson;
                p.TemplateVersion = template.Version;
                p.UpdatedAtUtc = DateTime.UtcNow;
                p.LastEditorUserId = userId > 0 ? userId : null;
                pushed++;
            }
        }

        await _db.SaveChangesAsync(ct);
        return (true, null, pushed);
    }

    /// <summary>Create a process from a template. The template's sources are deliberately not copied.</summary>
    public async Task<(bool ok, string? error, Process? process)> CreateProcessAsync(
        int userId, int templateId, CreateFromTemplateRequest request, CancellationToken ct = default)
    {
        var title = request.Title?.Trim();
        if (string.IsNullOrWhiteSpace(title)) return (false, "template.titleRequired", null);

        var template = await _db.ProcessTemplates.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == templateId, ct);
        if (template is null) return (false, "template.notFound", null);
        if (!template.IsActive) return (false, "template.inactive", null);

        var user = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct);
        var entitlements = user is null
            ? EntitlementService.LocalDefaults()
            : await _entitlements.ResolveForUserAsync(user, ct);
        if (userId > 0) await _entitlements.EnsureCanCreateTaskAsync(userId, entitlements, ct);

        var process = new Process
        {
            Title = title,
            GraphJson = template.GraphJson,
            CreatorUserId = userId > 0 ? userId : null,
            LastEditorUserId = userId > 0 ? userId : null,
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow,
            TemplateId = template.Id,
            TemplateVersion = template.Version
        };

        if (userId > 0)
        {
            process.Shares.Add(new ProcessShare
            {
                UserId = userId,
                CanView = true,
                CanEdit = true,
                CanDelete = true,
                CanExecute = true,
                CanChangeDataSource = true,
                GrantedAtUtc = DateTime.UtcNow,
                GrantedByUserId = userId
            });
        }

        _db.Processes.Add(process);
        await _db.SaveChangesAsync(ct);
        return (true, null, process);
    }

    /// <summary>
    /// Detach a process from its template. The process keeps the graph it has right now — the
    /// caller does not need to copy anything first — and stops receiving later template changes.
    /// </summary>
    public async Task<(bool ok, string? error)> DetachAsync(int userId, int processId, CancellationToken ct = default)
    {
        var process = await _db.Processes.FirstOrDefaultAsync(p => p.Id == processId, ct);
        if (process is null) return (false, "template.processNotFound");
        if (process.TemplateId is null) return (true, null); // already detached: nothing to do

        process.TemplateId = null;
        process.TemplateVersion = null;
        process.UpdatedAtUtc = DateTime.UtcNow;
        process.LastEditorUserId = userId > 0 ? userId : null;
        await _db.SaveChangesAsync(ct);
        return (true, null);
    }

    /// <summary>Pull the template's current graph into one attached process without detaching it.</summary>
    public async Task<(bool ok, string? error)> PullLatestAsync(int userId, int processId, CancellationToken ct = default)
    {
        var process = await _db.Processes.FirstOrDefaultAsync(p => p.Id == processId, ct);
        if (process is null) return (false, "template.processNotFound");
        if (process.TemplateId is not int templateId) return (false, "template.notAttached");

        var template = await _db.ProcessTemplates.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == templateId, ct);
        if (template is null) return (false, "template.notFound");

        process.GraphJson = template.GraphJson;
        process.TemplateVersion = template.Version;
        process.UpdatedAtUtc = DateTime.UtcNow;
        process.LastEditorUserId = userId > 0 ? userId : null;
        await _db.SaveChangesAsync(ct);
        return (true, null);
    }

    /// <summary>
    /// Whether an edit to this process's graph belongs on the process or on its template.
    /// Returns the template id when the graph must be saved through the template instead, so the
    /// editor can redirect rather than silently diverging from the template it claims to follow.
    /// </summary>
    public async Task<int?> RedirectGraphSaveToTemplateAsync(int processId, CancellationToken ct = default)
    {
        var process = await _db.Processes.AsNoTracking()
            .Where(p => p.Id == processId)
            .Select(p => new { p.TemplateId })
            .FirstOrDefaultAsync(ct);
        return process?.TemplateId;
    }

    /// <summary>
    /// True when a template has been published since this process last inherited it. The list row
    /// shows this as "template updated" so an author can pull the change in.
    /// </summary>
    public async Task<HashSet<int>> FindBehindProcessIdsAsync(IReadOnlyList<int> processIds, CancellationToken ct = default)
    {
        var behind = new HashSet<int>();
        if (processIds.Count == 0) return behind;

        var rows = await _db.Processes.AsNoTracking()
            .Where(p => processIds.Contains(p.Id) && p.TemplateId != null)
            .Select(p => new
            {
                p.Id,
                p.TemplateVersion,
                CurrentVersion = p.Template != null ? (int?)p.Template.Version : null
            })
            .ToListAsync(ct);

        foreach (var r in rows)
        {
            if (r.CurrentVersion is int current && (r.TemplateVersion ?? 0) < current) behind.Add(r.Id);
        }
        return behind;
    }
}
