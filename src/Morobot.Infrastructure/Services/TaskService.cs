using System.Text.Json;
using System.Text.Json.Nodes;
using Morobot.Contracts.Auth;
using Morobot.Contracts.Recordings;
using Morobot.Contracts.Tasks;
using Morobot.Domain;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Services;

public class TaskService
{
    private readonly AppDbContext _db;
    private readonly EntitlementService _entitlements;
    private readonly DataSourceService _dataSources;
    private readonly DeploymentBindingService _deploymentBinding;

    public TaskService(
        AppDbContext db,
        EntitlementService entitlements,
        DataSourceService dataSources,
        DeploymentBindingService deploymentBinding)
    {
        _db = db;
        _entitlements = entitlements;
        _dataSources = dataSources;
        _deploymentBinding = deploymentBinding;
    }

    public async Task<List<TaskListItemDto>> ListForUserAsync(int userId, CancellationToken ct = default)
    {
        var entitlementsUser = await _db.Users.AsNoTracking().Include(u => u.Plan)
            .FirstOrDefaultAsync(u => u.Id == userId, ct);
        var canSharePlan = entitlementsUser?.Plan?.CanShare == true
                           && !(entitlementsUser.Plan != null && PasswordPolicy.IsLocal(entitlementsUser.Plan.Code));

        var licensed = await _deploymentBinding.IsLicensedBypassAsync(ct);
        var currentInstanceId = licensed ? Guid.Empty : await _deploymentBinding.GetCurrentInstanceIdAsync(ct);

        var rows = await _db.ProcessShares
            .AsNoTracking()
            .Where(a => a.UserId == userId)
            .Where(a => licensed || a.Process.DeploymentInstanceId == currentInstanceId)
            .Select(a => new
            {
                a.Process.Id,
                a.Process.Title,
                a.Process.CreatedAtUtc,
                a.Process.UpdatedAtUtc,
                a.Process.GraphJson,
                a.Process.DesignOrigin,
                a.Process.CreatorUserId,
                OwnerUserName = a.Process.Creator != null ? a.Process.Creator.UserName : null,
                LastEditorUserName = a.Process.LastEditor != null ? a.Process.LastEditor.UserName : null,
                DataUpdatedAtUtc = a.Process.DataSourceLinks
                    .Select(l => (DateTime?)l.DataSource!.UpdatedAtUtc)
                    .Max(),
                DataLastEditorUserName = a.Process.DataSourceLinks
                    .OrderByDescending(l => l.DataSource!.UpdatedAtUtc)
                    .Select(l => l.DataSource!.LastEditor != null ? l.DataSource.LastEditor.UserName : null)
                    .FirstOrDefault(),
                a.CanEdit,
                a.CanDelete,
                a.CanExecute,
                a.CanChangeDataSource,
                a.Process.TemplateId,
                TemplateTitle = a.Process.Template != null ? a.Process.Template.Title : null,
                a.Process.TemplateVersion,
                CurrentTemplateVersion = a.Process.Template != null ? (int?)a.Process.Template.Version : null,
                // The mother is reached through the template's source link: a child holds a
                // TemplateId, so Template.SourceProcess is the mother process itself.
                SourceProcessId = a.Process.Template != null ? a.Process.Template.SourceProcessId : null,
                SourceProcessTitle = a.Process.Template != null && a.Process.Template.SourceProcess != null
                    ? a.Process.Template.SourceProcess.Title : null,
                // The mother is the template's SOURCE, and deliberately carries no TemplateId of
                // its own — so this has to go through SourceOfTemplate. Testing TemplateId would
                // report false for the one row the badge exists to mark.
                IsTemplateSource = a.Process.SourceOfTemplate != null,
                SharedWithCount = a.Process.Shares.Count(x => x.UserId != a.Process.CreatorUserId),
                DataSourceCount = a.Process.DataSourceLinks.Count
            })
            .OrderByDescending(t => t.Id)
            .ToListAsync(ct);

        var lastPlays = await LoadLastPlayByTaskAsync(rows.Select(r => r.Id).ToList(), ct);

        return rows.Select(a =>
        {
            var (groups, steps) = GraphJsonHelper.CountNodes(a.GraphJson);
            var isOwner = a.CreatorUserId == userId;
            var canEdit = a.CanEdit || isOwner;
            (DateTime AtUtc, string? UserName, int Count)? play = lastPlays.TryGetValue(a.Id, out var lp) ? lp : null;
            return new TaskListItemDto
            {
                Id = a.Id,
                Title = a.Title,
                CreatedAtUtc = a.CreatedAtUtc,
                UpdatedAtUtc = a.UpdatedAtUtc == default ? a.CreatedAtUtc : a.UpdatedAtUtc,
                LastEditorUserName = a.LastEditorUserName,
                DataUpdatedAtUtc = a.DataUpdatedAtUtc,
                DataLastEditorUserName = a.DataLastEditorUserName,
                LastPlayedAtUtc = play?.AtUtc,
                LastPlayedByUserName = play?.UserName,
                PlayCount = play?.Count ?? 0,
                GroupCount = groups,
                StepCount = steps,
                DataSourceCount = a.DataSourceCount,
                IsOwner = isOwner,
                CanView = true,
                CanEdit = canEdit,
                CanModify = canEdit,
                CanDelete = a.CanDelete || isOwner,
                CanExecute = a.CanExecute || isOwner,
                CanChangeDataSource = a.CanChangeDataSource || canEdit,
                CanShare = canSharePlan && (isOwner || canEdit),
                DesignOrigin = a.DesignOrigin.ToString(),
                OwnerUserName = a.OwnerUserName,
                SharedWithCount = a.SharedWithCount,
                TemplateId = a.TemplateId,
                TemplateTitle = a.TemplateTitle,
                SourceProcessId = a.SourceProcessId,
                SourceProcessTitle = a.SourceProcessTitle,
                // Behind means the template has published since this process last inherited it.
                TemplateBehind = a.CurrentTemplateVersion is int currentVersion
                                 && (a.TemplateVersion ?? 0) < currentVersion,
                IsTemplateSource = a.IsTemplateSource
            };
        }).ToList();
    }

    /// <summary>
    /// Last play time, user and total count for each of the given tasks, keyed by task id.
    ///
    /// Reads the recorded PlayStarted events. The task id lives in DetailsJson, not in the
    /// message text: the message is written for a human reading the log, and cutting an id out
    /// of prose would break the first time the wording changes.
    ///
    /// Tasks with no play event are absent from the dictionary, which is the honest answer -
    /// they have never been run - and the caller renders that as "never" rather than a date.
    /// </summary>
    private async Task<Dictionary<int, (DateTime AtUtc, string? UserName, int Count)>> LoadLastPlayByTaskAsync(
        IReadOnlyList<int> taskIds, CancellationToken ct)
    {
        var result = new Dictionary<int, (DateTime, string?, int)>();
        if (taskIds.Count == 0) return result;

        // One query for the whole page rather than one per row.
        var events = await _db.EventLogs.AsNoTracking()
            .Where(e => e.Category == "Play" && e.EventType == "PlayStarted" && e.DetailsJson != null)
            .Select(e => new { e.DetailsJson, e.CreatedAtUtc, e.UserName })
            .ToListAsync(ct);

        var wanted = new HashSet<int>(taskIds);
        var grouped = new Dictionary<int, List<(DateTime AtUtc, string? UserName)>>();
        foreach (var e in events)
        {
            int? taskId = null;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(e.DetailsJson!);
                if (doc.RootElement.TryGetProperty("taskId", out var v))
                {
                    // Stored as a string by the hub, but accept a number too.
                    taskId = v.ValueKind == System.Text.Json.JsonValueKind.Number
                        ? v.GetInt32()
                        : int.TryParse(v.GetString(), out var parsed) ? parsed : null;
                }
            }
            catch { /* an unreadable row is skipped, not fatal */ }

            if (taskId is not int id || !wanted.Contains(id)) continue;
            if (!grouped.TryGetValue(id, out var list)) grouped[id] = list = new List<(DateTime, string?)>();
            list.Add((e.CreatedAtUtc, e.UserName));
        }

        foreach (var (id, list) in grouped)
        {
            var latest = list.OrderByDescending(x => x.AtUtc).First();
            result[id] = (latest.AtUtc, latest.UserName, list.Count);
        }
        return result;
    }

    /// <summary>
    /// The recorded play starts for one task, newest first - the run history behind the
    /// processes list's history button.
    ///
    /// Reads the same PlayStarted events the last-run column uses, so the button and the column
    /// can never disagree. Limited to a page of entries: the list is there to answer "when and
    /// how often", not to be an audit export.
    /// </summary>
    public async Task<List<TaskRunEntry>> ListRunsAsync(int taskId, int take = 50, CancellationToken ct = default)
    {
        var events = await _db.EventLogs.AsNoTracking()
            .Where(e => e.Category == "Play" && e.EventType == "PlayStarted" && e.DetailsJson != null)
            .OrderByDescending(e => e.CreatedAtUtc)
            .Select(e => new { e.DetailsJson, e.CreatedAtUtc, e.UserName })
            .ToListAsync(ct);

        var runs = new List<TaskRunEntry>();
        foreach (var e in events)
        {
            if (runs.Count >= take) break;
            int? id = null;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(e.DetailsJson!);
                if (doc.RootElement.TryGetProperty("taskId", out var v))
                {
                    id = v.ValueKind == System.Text.Json.JsonValueKind.Number
                        ? v.GetInt32()
                        : int.TryParse(v.GetString(), out var parsed) ? parsed : null;
                }
            }
            catch { /* skip unreadable rows */ }

            if (id != taskId) continue;
            runs.Add(new TaskRunEntry { AtUtc = e.CreatedAtUtc, UserName = e.UserName });
        }
        return runs;
    }

    public async Task<List<TaskListItemDto>> ListAllForAdminAsync(CancellationToken ct = default)
    {
        var rows = await _db.Processes.AsNoTracking()
            .Select(t => new
            {
                t.Id,
                t.Title,
                t.CreatedAtUtc,
                t.UpdatedAtUtc,
                t.GraphJson,
                t.DesignOrigin,
                OwnerUserName = t.Creator != null ? t.Creator.UserName : null,
                // The admin list names the person, not the login. Composed here rather than in the
                // view so the live-update payload (which reuses this DTO) carries it too.
                OwnerFullName = t.Creator != null
                    ? ((t.Creator.FirstName ?? "") + " " + (t.Creator.LastName ?? "")).Trim()
                    : null,
                LastEditorUserName = t.LastEditor != null ? t.LastEditor.UserName : null,
                DataUpdatedAtUtc = t.DataSourceLinks
                    .Select(l => (DateTime?)l.DataSource!.UpdatedAtUtc)
                    .Max(),
                DataLastEditorUserName = t.DataSourceLinks
                    .OrderByDescending(l => l.DataSource!.UpdatedAtUtc)
                    .Select(l => l.DataSource!.LastEditor != null ? l.DataSource.LastEditor.UserName : null)
                    .FirstOrDefault(),
                DataSourceCount = t.DataSourceLinks.Count,
                t.TemplateId,
                TemplateTitle = t.Template != null ? t.Template.Title : null,
                t.TemplateVersion,
                CurrentTemplateVersion = t.Template != null ? (int?)t.Template.Version : null,
                SourceProcessId = t.Template != null ? t.Template.SourceProcessId : null,
                SourceProcessTitle = t.Template != null && t.Template.SourceProcess != null
                    ? t.Template.SourceProcess.Title : null,
                // Same reasoning as the user list: the mother is found through the template's
                // source link, because the mother itself holds no TemplateId.
                IsTemplateSource = t.SourceOfTemplate != null,
                // For a mother: how many children its template holds. Deleting the mother deletes
                // that template and detaches them, and this is the number the admin must be warned
                // about — so it is projected with the row rather than fetched per delete click.
                TemplateChildCount = t.SourceOfTemplate != null ? t.SourceOfTemplate.Processes.Count : 0
            })
            .OrderByDescending(t => t.Id)
            .ToListAsync(ct);

        var adminLastPlays = await LoadLastPlayByTaskAsync(rows.Select(r => r.Id).ToList(), ct);

        return rows.Select(t =>
        {
            var (groups, steps) = GraphJsonHelper.CountNodes(t.GraphJson);
            (DateTime AtUtc, string? UserName, int Count)? play = adminLastPlays.TryGetValue(t.Id, out var lp) ? lp : null;
            return new TaskListItemDto
            {
                Id = t.Id,
                Title = t.Title,
                CreatedAtUtc = t.CreatedAtUtc,
                UpdatedAtUtc = t.UpdatedAtUtc == default ? t.CreatedAtUtc : t.UpdatedAtUtc,
                LastEditorUserName = t.LastEditorUserName,
                DataUpdatedAtUtc = t.DataUpdatedAtUtc,
                DataLastEditorUserName = t.DataLastEditorUserName,
                LastPlayedAtUtc = play?.AtUtc,
                LastPlayedByUserName = play?.UserName,
                PlayCount = play?.Count ?? 0,
                GroupCount = groups,
                StepCount = steps,
                DataSourceCount = t.DataSourceCount,
                CanModify = true,
                DesignOrigin = t.DesignOrigin.ToString(),
                OwnerUserName = t.OwnerUserName,
                OwnerFullName = string.IsNullOrWhiteSpace(t.OwnerFullName) ? null : t.OwnerFullName,
                TemplateId = t.TemplateId,
                TemplateTitle = t.TemplateTitle,
                SourceProcessId = t.SourceProcessId,
                SourceProcessTitle = t.SourceProcessTitle,
                TemplateBehind = t.CurrentTemplateVersion is int adminCurrentVersion
                                 && (t.TemplateVersion ?? 0) < adminCurrentVersion,
                IsTemplateSource = t.IsTemplateSource,
                TemplateChildCount = t.TemplateChildCount
            };
        }).ToList();
    }

    public async Task<List<AdminCanvasSourceRow>> ListCanvasSourcesForAdminAsync(CancellationToken ct = default)
    {
        var lib = await _dataSources.ListAllForAdminAsync(ct);
        return lib.Select(d => new AdminCanvasSourceRow
        {
            SourceId = d.Id.ToString(),
            Title = d.Title,
            TaskId = 0,
            TaskTitle = d.LinkedProcessTitles,
            // Kept alongside the titles so the page can tell "used by nobody" (and therefore
            // deletable as unused) from "used by processes" without parsing the joined titles.
            LinkedProcessCount = d.LinkedProcessCount,
            Owner = d.OwnerUserName,
            LastEditor = d.LastEditorUserName ?? d.OwnerUserName,
            CreatedAtUtc = d.CreatedAtUtc,
            UpdatedAtUtc = d.UpdatedAtUtc,
            ColumnCount = d.ColumnCount,
            RowCount = d.RowCount
        }).ToList();
    }

    public async Task<Process> CreateAsync(int userId, CreateTaskRequest request, CancellationToken ct = default)
        => await CreateAsync(userId, request, entitlements: null, ct);

    public async Task<Process> CreateAsync(int userId, CreateTaskRequest request, EntitlementsDto? entitlements, CancellationToken ct)
    {
        if (entitlements is null && userId > 0)
        {
            var dbUser = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct);
            entitlements = dbUser is null
                ? EntitlementService.LocalDefaults()
                : await _entitlements.ResolveForUserAsync(dbUser, ct);
        }
        entitlements ??= EntitlementService.LocalDefaults();
        if (userId > 0)
            await _entitlements.EnsureCanCreateTaskAsync(userId, entitlements, ct);

        var process = new Process
        {
            Title = request.Title.Trim(),
            DelayBeforeMs = request.DelayBeforeMs,
            DelayAfterMs = request.DelayAfterMs,
            CreatorUserId = userId > 0 ? userId : null,
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow,
            LastEditorUserId = userId > 0 ? userId : null,
            DesignOrigin = Enum.TryParse<TaskDesignOrigin>(request.DesignOrigin, true, out var origin)
                ? origin
                : TaskDesignOrigin.Manual
        };
        await _deploymentBinding.StampProcessAsync(process, ct);
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
        return process;
    }

    /// <summary>
    /// Copy a process on the server: a new record with the graph and the linked sources.
    /// </summary>
    /// <remarks>
    /// The copy is a server row, not a browser-side entry. Copying only in localStorage produced a
    /// process that existed on one machine and vanished on the next sign-in, and its data-source
    /// links — which live in their own table — were never created at all.
    ///
    /// The source rows are <b>shared, not duplicated</b>: links point at the same DataSources
    /// records. Duplicating them would multiply a customer's data-source quota every time they
    /// copied a process, and the library is meant to hold one row per real source. Editing the
    /// source from either process therefore affects both, which is the existing behaviour for a
    /// process that shares a source.
    /// </remarks>
    public async Task<Process?> CloneAsync(int userId, int taskId, string? newTitle, CancellationToken ct = default)
    {
        if (!await CanViewAsync(userId, taskId, ct)) return null;

        var source = await _db.Processes.AsNoTracking()
            .Include(p => p.DataSourceLinks)
            .FirstOrDefaultAsync(p => p.Id == taskId, ct);
        if (source is null) return null;

        var title = string.IsNullOrWhiteSpace(newTitle) ? BuildCloneTitle(source.Title) : newTitle.Trim();
        var copy = await CreateAsync(userId, new CreateTaskRequest
        {
            Title = title,
            // The copy is manual work regardless of how the original was produced: it is no longer
            // the artefact the recorder wrote.
            DesignOrigin = nameof(TaskDesignOrigin.Manual)
        }, entitlements: null, ct);

        // Straight assignment, not a parse/re-serialise round trip: the graph is copied verbatim so
        // nothing in an unfamiliar shape is lost, and only the identity fields that must not be
        // shared are rewritten.
        copy.GraphJson = RewriteGraphIdentity(source.GraphJson, copy.Id, title);
        copy.DelayBeforeMs = source.DelayBeforeMs;
        copy.DelayAfterMs = source.DelayAfterMs;
        copy.UpdatedAtUtc = DateTime.UtcNow;
        copy.LastEditorUserId = userId > 0 ? userId : null;

        foreach (var link in source.DataSourceLinks)
        {
            _db.ProcessDataSources.Add(new ProcessDataSource
            {
                ProcessId = copy.Id,
                DataSourceId = link.DataSourceId,
                IsDefault = link.IsDefault,
                SortOrder = link.SortOrder
            });
        }

        // A copy of a child is itself a child of the same template. The point of copying one is to
        // get another process that shares the structure and differs in its data source, so cutting
        // the link here would hand back a process that has silently stopped following the template.
        //
        // Its start node came over with the graph and stays its own: the copy points at whichever
        // source it inherited, independently of the original (the library row is shared, but the
        // choice of row is not).
        if (source.TemplateId is int templateId)
        {
            copy.TemplateId = templateId;
            var templateVersion = await _db.ProcessTemplates
                .Where(t => t.Id == templateId)
                .Select(t => (int?)t.Version)
                .FirstOrDefaultAsync(ct);
            copy.TemplateVersion = templateVersion;
        }

        await _db.SaveChangesAsync(ct);
        return copy;
    }

    /// <summary>Name for a copy: "&lt;title&gt; (copy)", with a counter so repeated copies stay distinct.</summary>
    private static string BuildCloneTitle(string? originalTitle)
    {
        var baseTitle = string.IsNullOrWhiteSpace(originalTitle) ? "فرآیند" : originalTitle.Trim();
        return $"{baseTitle} (کپی)";
    }

    /// <summary>
    /// Point a copied graph at its new process. Everything else is left byte-for-byte as stored.
    /// </summary>
    /// <remarks>
    /// The taskId inside the graph is what the editor and the player use to identify the process,
    /// so a copy that kept the original's id would save over the original.
    /// </remarks>
    private static string? RewriteGraphIdentity(string? graphJson, int newTaskId, string title)
    {
        if (string.IsNullOrWhiteSpace(graphJson)) return graphJson;
        try
        {
            // Distinct from RecordingService.JsonOpts: this type does not inherit that field.
            var opts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            var obj = JsonNode.Parse(graphJson) as JsonObject;
            if (obj is null) return graphJson;

            // Some rows are stored as an envelope { title, graphJson }. Patch whichever level
            // actually holds the graph so the copy is correct either way.
            var target = obj["graphJson"] is JsonValue inner && inner.TryGetValue<string>(out var innerText)
                ? JsonNode.Parse(innerText) as JsonObject
                : obj;
            if (target is null) return graphJson;

            target["taskId"] = newTaskId;
            target["title"] = title;

            if (!ReferenceEquals(target, obj))
            {
                obj["graphJson"] = target.ToJsonString(opts);
                obj["title"] = title;
                return obj.ToJsonString(opts);
            }
            return target.ToJsonString(opts);
        }
        catch (JsonException)
        {
            // Unparseable graph: keep the bytes rather than losing the process.
            return graphJson;
        }
    }

    /// <summary>
    /// What deleting this process would take with it, so the caller can warn before it happens.
    /// </summary>
    /// <remarks>
    /// A MOTHER is not an ordinary process: it is the source of a template, and that template holds
    /// every child built on it. Deleting the mother deletes the template too (the template has no
    /// meaning without the process that owns its structure), and the children are detached so each
    /// keeps the graph it has right now. None of that is visible from the row being deleted, so the
    /// count is reported first and the UI must confirm it.
    ///
    /// Reported as one object rather than separate lookups so the delete and its warning cannot
    /// disagree about what is about to happen.
    /// </remarks>
    public async Task<(bool isMother, int templateId, string? templateTitle, int childCount)> GetDeleteImpactAsync(
        int taskId, CancellationToken ct = default)
    {
        var template = await _db.ProcessTemplates.AsNoTracking()
            .Where(t => t.SourceProcessId == taskId)
            .Select(t => new { t.Id, t.Title })
            .FirstOrDefaultAsync(ct);
        if (template is null) return (false, 0, null, 0);

        // Children = attached processes other than the mother itself, which never carries a
        // TemplateId but is guarded for anyway so the count cannot be inflated.
        var childCount = await _db.Processes.CountAsync(
            p => p.TemplateId == template.Id && p.Id != taskId, ct);

        return (true, template.Id, template.Title, childCount);
    }

    /// <summary>
    /// Delete a process. When it is a template's MOTHER the template is deleted with it.
    /// </summary>
    /// <remarks>
    /// The template only exists to hold the structure the mother owns, so leaving it behind would
    /// strand a skeleton that can never be republished (its source is gone) while its children keep
    /// claiming to follow it — the state the old code produced with a plain <c>SetNull</c>. Deleting
    /// both together, and detaching the children to their current graph, is the only outcome that
    /// leaves the data coherent.
    ///
    /// The children are detached explicitly rather than left to the foreign key: their
    /// <c>TemplateId</c> points at a row that is about to disappear, and <c>Restrict</c> on that
    /// relation would refuse the delete outright. Detaching first is what makes the delete possible
    /// and is also what the user is being warned about.
    ///
    /// Returns how many children were detached, or -1 when the process was not found.
    /// </remarks>
    public async Task<int> DeleteAsync(int taskId, CancellationToken ct = default)
    {
        // ProcessDataSources links cascade; DataSources library rows are kept (independent entities).
        var process = await _db.Processes.FirstOrDefaultAsync(t => t.Id == taskId, ct);
        if (process is null) return -1;

        var detached = 0;

        // Take the template down with the mother, and cut the children loose first so the delete can
        // proceed at all (Process.TemplateId is Restrict).
        var template = await _db.ProcessTemplates
            .FirstOrDefaultAsync(t => t.SourceProcessId == taskId, ct);
        if (template is not null)
        {
            var children = await _db.Processes
                .Where(p => p.TemplateId == template.Id && p.Id != taskId)
                .ToListAsync(ct);
            foreach (var child in children)
            {
                child.TemplateId = null;
                child.TemplateVersion = null;
                child.UpdatedAtUtc = DateTime.UtcNow;
            }
            detached = children.Count;

            // Break the mother -> template link before removing the mother, so the delete no longer
            // depends on the FK behaviour to sort it out.
            template.SourceProcessId = null;
            _db.ProcessTemplates.Remove(template);
        }

        _db.Processes.Remove(process);
        await _db.SaveChangesAsync(ct);
        return detached;
    }

    public async Task<bool> CanModifyAsync(int userId, int taskId, CancellationToken ct = default)
        => await CanEditAsync(userId, taskId, ct);

    public async Task<bool> CanEditAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.ProcessShares.AnyAsync(a =>
            a.UserId == userId &&
            a.ProcessId == taskId &&
            (a.CanEdit || a.Process.CreatorUserId == userId), ct);
    }

    public async Task<bool> CanDeleteAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.ProcessShares.AnyAsync(a =>
            a.UserId == userId &&
            a.ProcessId == taskId &&
            (a.CanDelete || a.Process.CreatorUserId == userId), ct);
    }

    public async Task<bool> CanExecuteAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.ProcessShares.AnyAsync(a =>
            a.UserId == userId &&
            a.ProcessId == taskId &&
            (a.CanExecute || a.Process.CreatorUserId == userId), ct);
    }

    public async Task<bool> CanChangeDataSourceAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.ProcessShares.AnyAsync(a =>
            a.UserId == userId &&
            a.ProcessId == taskId &&
            (a.CanChangeDataSource || a.CanEdit || a.Process.CreatorUserId == userId), ct);
    }

    public async Task<bool> CanViewAsync(int userId, int taskId, CancellationToken ct = default)
    {
        if (!await _deploymentBinding.IsProcessAccessibleAsync(taskId, ct))
            return false;
        return await _db.ProcessShares.AnyAsync(a => a.UserId == userId && a.ProcessId == taskId, ct);
    }

    public async Task<(string? json, DateTime updatedAtUtc)?> GetCanvasAsync(int userId, int taskId, CancellationToken ct = default)
    {
        if (!await CanViewAsync(userId, taskId, ct))
            return null;
        var row = await _db.Processes.AsNoTracking()
            .Where(t => t.Id == taskId)
            .Select(t => new { t.GraphJson, t.UpdatedAtUtc, t.CreatedAtUtc })
            .FirstOrDefaultAsync(ct);
        if (row is null) return null;
        var updated = row.UpdatedAtUtc == default ? row.CreatedAtUtc : row.UpdatedAtUtc;
        var hydrated = await _dataSources.HydrateCanvasAsync(taskId, row.GraphJson, ct);
        return (hydrated, DateTime.SpecifyKind(updated, DateTimeKind.Utc));
    }

    public async Task<string?> GetCanvasJsonAsync(int userId, int taskId, CancellationToken ct = default)
    {
        var hit = await GetCanvasAsync(userId, taskId, ct);
        return hit?.json;
    }

    /// <summary>
    /// Patch the step gap and highlight colour onto the process's start node.
    /// </summary>
    /// <remarks>
    /// A surgical write rather than a canvas save. The player only owns these two fields, and sending
    /// a whole canvas back would make it a second author of the graph — it would overwrite any edit
    /// made in the panel editor between the player opening the process and saving a setting. Touching
    /// two keys cannot do that.
    /// </remarks>
    public async Task<bool> PatchRunSettingsAsync(
        int userId, int taskId, int stepDelayMs, string? highlightColor, CancellationToken ct = default)
    {
        if (!await CanViewAsync(userId, taskId, ct)) return false;
        var process = await _db.Processes.FirstOrDefaultAsync(p => p.Id == taskId, ct);
        if (process is null) return false;

        var envelope = GraphJsonHelper.TryParseEnvelope(process.GraphJson, out var bodyText);
        var bodyJson = envelope is null ? process.GraphJson : bodyText;

        JsonNode? root;
        try { root = JsonNode.Parse(bodyJson); }
        catch { return false; }
        if (root is not JsonObject obj) return false;

        var startNode = (obj["nodes"] as JsonArray)?
            .OfType<JsonObject>()
            .FirstOrDefault(n =>
                string.Equals(n["kind"]?.GetValue<string>(), "start", StringComparison.OrdinalIgnoreCase)
                && n["groupNodeId"] is null);
        // A process always has a start node; if it does not, the graph is not one we should be
        // editing blind, so the caller is told nothing was written rather than being lied to.
        if (startNode is null) return false;

        startNode["stepDelayMs"] = stepDelayMs;
        // The graph-level mirrors are kept in step, exactly as the editor keeps them: a payload
        // without a start node, or an older reader, still finds the values where it expects them.
        obj["stepDelayMs"] = stepDelayMs;
        if (highlightColor is not null)
        {
            startNode["highlightColor"] = highlightColor;
            obj["highlightColor"] = highlightColor;
        }

        var newBody = obj.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
        if (envelope is null)
        {
            process.GraphJson = newBody;
        }
        else
        {
            // Write the patched graph back INTO the envelope, preserving every other field the
            // envelope carries (session/concurrency metadata). Replacing the envelope wholesale would
            // drop those.
            if (envelope["graphJson"] is not null) envelope["graphJson"] = newBody;
            else envelope["GraphJson"] = newBody;
            process.GraphJson = envelope.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
        }
        process.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// If this process was created from a template it is that template's CHILD, and the editor has
    /// to open in restricted mode: the diagram is read-only apart from the start node's own
    /// parameters (data source, border colour, repeat mode/range, delay, loop limits), because
    /// every other node and edge is a projection of the mother process that the cascade will
    /// overwrite on the next publish.
    ///
    /// Returns <c>null</c> for an ordinary process, so the caller can simply check for a value.
    /// </summary>
    /// <remarks>
    /// The MOTHER process is deliberately not reported as a child. It also carries a
    /// <c>TemplateId</c> pointing at the template made from it, so a plain "has a template id"
    /// test would lock the very process an author is supposed to edit. The mother is recognised by
    /// being the template's <c>SourceProcessId</c>, and it must never be treated as its own child —
    /// a cascade would otherwise overwrite the graph the template was authored from.
    /// </remarks>
    public async Task<(int TemplateId, string TemplateTitle)?> GetTemplateOriginAsync(
        int userId, int taskId, CancellationToken ct = default)
    {
        if (!await CanViewAsync(userId, taskId, ct))
            return null;

        var row = await _db.Processes.AsNoTracking()
            .Where(t => t.Id == taskId && t.TemplateId != null)
            .Select(t => new
            {
                TemplateId = t.TemplateId!.Value,
                Title = t.Template != null ? t.Template.Title : null,
                // True when this process is the process the template was built from. Read through
                // the template's source link: the mother carries no TemplateId of its own.
                IsSource = t.SourceOfTemplate != null
            })
            .FirstOrDefaultAsync(ct);

        if (row is null || row.IsSource) return null;
        return (row.TemplateId, row.Title ?? "");
    }

    public async Task<(bool ok, string? error, DateTime? updatedAtUtc)> UpdateTitleAsync(
        int userId, int taskId, string? title, CancellationToken ct = default)
    {
        if (!await CanModifyAsync(userId, taskId, ct))
            return (false, "forbidden", null);
        var trimmed = (title ?? "").Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            return (false, "عنوان فرآیند لازم است.", null);
        if (trimmed.Length > 200) trimmed = trimmed[..200];

        var process = await _db.Processes.FirstOrDefaultAsync(t => t.Id == taskId, ct);
        if (process is null) return (false, "notfound", null);

        process.Title = trimmed;
        if (!string.IsNullOrWhiteSpace(process.GraphJson))
        {
            try
            {
                var node = System.Text.Json.Nodes.JsonNode.Parse(process.GraphJson) as System.Text.Json.Nodes.JsonObject;
                if (node is not null)
                {
                    node["title"] = trimmed;
                    process.GraphJson = node.ToJsonString(new System.Text.Json.JsonSerializerOptions
                    {
                        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
                    });
                }
            }
            catch { /* keep title on entity even if graph patch fails */ }
        }
        process.UpdatedAtUtc = DateTime.UtcNow;
        process.LastEditorUserId = userId > 0 ? userId : process.LastEditorUserId;
        await _db.SaveChangesAsync(ct);
        return (true, null, DateTime.SpecifyKind(process.UpdatedAtUtc, DateTimeKind.Utc));
    }

    public async Task<(bool ok, string? error, DateTime? updatedAtUtc)> SaveCanvasJsonAsync(
        int userId, int taskId, string canvasJson, string? title,
        DateTime? baseUpdatedAtUtc = null, EntitlementsDto? entitlements = null, CancellationToken ct = default)
    {
        if (!await CanModifyAsync(userId, taskId, ct))
            return (false, "forbidden", null);
        var process = await _db.Processes
            .Include(p => p.DataSourceLinks)
            .FirstOrDefaultAsync(t => t.Id == taskId, ct);
        if (process is null) return (false, "notfound", null);

        var currentUpdated = process.UpdatedAtUtc == default ? process.CreatedAtUtc : process.UpdatedAtUtc;
        if (baseUpdatedAtUtc.HasValue)
        {
            var client = AsUtcWallClock(baseUpdatedAtUtc.Value);
            var server = AsUtcWallClock(currentUpdated);
            if (Math.Abs((server - client).TotalSeconds) > 1.0)
                return (false, "conflict", DateTime.SpecifyKind(server, DateTimeKind.Utc));
        }

        if (entitlements is null)
        {
            var dbUser = await _db.Users.AsNoTracking().Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct);
            entitlements = dbUser is null
                ? EntitlementService.LocalDefaults()
                : await _entitlements.ResolveForUserAsync(dbUser, ct);
        }

        if (entitlements.MaxDataSources is int maxSrc)
        {
            var ownerId = process.CreatorUserId ?? userId;
            var libraryCount = await _entitlements.CountLibraryDataSourcesAsync(ownerId, ct);
            var newOnes = await CountUnknownSourcesInCanvasAsync(canvasJson, ct);
            if (libraryCount + newOnes > maxSrc)
                return (false, $"Data source limit reached ({maxSrc}).", null);
        }

        if (entitlements.MaxProcessSteps is int maxSteps)
        {
            var steps = GraphJsonHelper.CountProcessSteps(canvasJson);
            if (steps > maxSteps)
                return (false, $"Process step limit reached ({maxSteps}).", null);
        }

        // Sync embedded canvas sources into the user library + process links (detach ≠ delete library).
        var synced = await _dataSources.SyncFromCanvasAsync(process, canvasJson, userId, ct);

        process.GraphJson = synced;
        if (!string.IsNullOrWhiteSpace(title))
            process.Title = title.Trim();
        process.UpdatedAtUtc = DateTime.UtcNow;
        process.LastEditorUserId = userId > 0 ? userId : process.LastEditorUserId;
        await _db.SaveChangesAsync(ct);
        return (true, null, DateTime.SpecifyKind(process.UpdatedAtUtc, DateTimeKind.Utc));
    }

    private async Task<int> CountUnknownSourcesInCanvasAsync(string canvasJson, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(canvasJson);
            if (!doc.RootElement.TryGetProperty("dataSources", out var arr)
                && !doc.RootElement.TryGetProperty("DataSources", out arr))
                return 0;
            if (arr.ValueKind != JsonValueKind.Array) return 0;
            var ids = new List<int>();
            foreach (var el in arr.EnumerateArray())
            {
                if (el.TryGetProperty("id", out var idEl) && idEl.TryGetInt32(out var id) && id > 0)
                    ids.Add(id);
                else if (el.TryGetProperty("Id", out var idEl2) && idEl2.TryGetInt32(out var id2) && id2 > 0)
                    ids.Add(id2);
                else
                    ids.Add(-1); // brand-new without id
            }
            if (ids.Count == 0) return 0;
            var known = await _db.DataSources.AsNoTracking()
                .Where(d => ids.Contains(d.Id))
                .Select(d => d.Id)
                .ToListAsync(ct);
            return ids.Count(id => id < 0 || !known.Contains(id));
        }
        catch { return 0; }
    }

    private static DateTime AsUtcWallClock(DateTime dt) =>
        dt.Kind switch
        {
            DateTimeKind.Utc => dt,
            DateTimeKind.Local => dt.ToUniversalTime(),
            _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
        };
}

public class RecordingService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private readonly AppDbContext _db;
    private readonly TaskService _tasks;

    public RecordingService(AppDbContext db, TaskService tasks)
    {
        _db = db;
        _tasks = tasks;
    }

    public async Task<SaveRecordingResponse> SaveAsync(int userId, SaveRecordingRequest request, CancellationToken ct = default)
    {
        Process process;
        if (request.TaskId is int taskId)
        {
            if (!await _tasks.CanModifyAsync(userId, taskId, ct))
                throw new UnauthorizedAccessException("No modify access to this task.");
            process = await _db.Processes.FirstAsync(t => t.Id == taskId, ct);
            process.DesignOrigin = TaskDesignOrigin.Recorded;
        }
        else
        {
            var title = string.IsNullOrWhiteSpace(request.NewTaskTitle)
                ? $"ضبط {DateTime.Now:yyyy-MM-dd HH:mm}"
                : request.NewTaskTitle.Trim();
            process = await _tasks.CreateAsync(userId, new CreateTaskRequest
            {
                Title = title,
                DesignOrigin = nameof(TaskDesignOrigin.Recorded)
            }, ct);
        }

        var root = string.IsNullOrWhiteSpace(process.GraphJson)
            ? new JsonObject
            {
                ["taskId"] = process.Id,
                ["title"] = process.Title,
                ["nodes"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["id"] = "start",
                        ["kind"] = "start",
                        ["title"] = "شروع",
                        ["x"] = 40,
                        ["y"] = 220
                    }
                },
                ["edges"] = new JsonArray(),
                ["dataSources"] = new JsonArray(),
                ["viewport"] = new JsonObject { ["x"] = 80, ["y"] = 40, ["zoom"] = 1 }
            }
            : JsonNode.Parse(process.GraphJson)!.AsObject();

        var nodes = root["nodes"] as JsonArray ?? new JsonArray();
        root["nodes"] = nodes;
        var edges = root["edges"] as JsonArray ?? new JsonArray();
        root["edges"] = edges;

        var groupUid = $"group-rec-{Guid.NewGuid():N}"[..20];
        var groupTitle = string.IsNullOrWhiteSpace(request.GroupTitle) ? "ضبط‌شده" : request.GroupTitle.Trim();
        var gx = 280 + nodes.Count(n =>
            string.Equals(n?["kind"]?.GetValue<string>(), "group", StringComparison.OrdinalIgnoreCase)) * 360;

        nodes.Add(new JsonObject
        {
            ["id"] = groupUid,
            ["kind"] = "group",
            ["title"] = groupTitle,
            ["repeatSourceType"] = "None",
            ["x"] = gx,
            ["y"] = 80
        });

        if (!edges.Any(e =>
                string.Equals(e?["from"]?.GetValue<string>(), "start", StringComparison.OrdinalIgnoreCase)
                && string.Equals(e?["kind"]?.GetValue<string>(), "next", StringComparison.OrdinalIgnoreCase)))
        {
            edges.Add(new JsonObject
            {
                ["id"] = $"e-start-{groupUid}",
                ["from"] = "start",
                ["to"] = groupUid,
                ["kind"] = "next"
            });
        }

        string? prevStepId = null;
        var sy = 0;
        var stepIndex = 0;
        foreach (var item in request.Actions)
        {
            stepIndex++;
            var stepId = $"step-rec-{Guid.NewGuid():N}"[..22];
            var framePath = JsonSerializer.SerializeToNode(item.FramePath, JsonOpts) ?? new JsonArray();
            var node = new JsonObject
            {
                ["id"] = stepId,
                ["kind"] = "step",
                ["title"] = $"{item.ActionType} {stepIndex}",
                ["groupNodeId"] = groupUid,
                ["actionType"] = item.ActionType,
                ["isActive"] = true,
                ["selectorValue"] = item.ElementValue,
                ["elementBy"] = item.ElementBy,
                ["framePath"] = framePath,
                ["constantValue"] = item.Value,
                ["navigateUrl"] = item.ActionType.Equals("GoToUrl", StringComparison.OrdinalIgnoreCase) ? item.Url : null,
                ["x"] = gx + 28,
                ["y"] = 150 + sy
            };
            nodes.Add(node);
            sy += 110;

            if (prevStepId is null)
            {
                edges.Add(new JsonObject
                {
                    ["id"] = $"e-g-{groupUid}",
                    ["from"] = groupUid,
                    ["to"] = stepId,
                    ["kind"] = "contains"
                });
            }
            else
            {
                edges.Add(new JsonObject
                {
                    ["id"] = $"e-n-{prevStepId}",
                    ["from"] = prevStepId,
                    ["to"] = stepId,
                    ["kind"] = "next"
                });
            }
            prevStepId = stepId;
        }

        root["taskId"] = process.Id;
        root["title"] = process.Title;
        root["designOrigin"] = nameof(TaskDesignOrigin.Recorded);
        process.GraphJson = root.ToJsonString(JsonOpts);
        process.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return new SaveRecordingResponse
        {
            TaskId = process.Id,
            GroupId = 0,
            StepCount = request.Actions.Count
        };
    }
}

public class AdminCanvasSourceRow
{
    public string SourceId { get; set; } = "";
    public string Title { get; set; } = "";
    public int TaskId { get; set; }
    public string TaskTitle { get; set; } = "";
    /// <summary>How many processes link this source. Zero means it is unused.</summary>
    public int LinkedProcessCount { get; set; }
    public string Owner { get; set; } = "";
    public string LastEditor { get; set; } = "";
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
}
