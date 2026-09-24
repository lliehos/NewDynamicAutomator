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
                SharedWithCount = a.Process.Shares.Count(x => x.UserId != a.Process.CreatorUserId),
                DataSourceCount = a.Process.DataSourceLinks.Count
            })
            .OrderByDescending(t => t.Id)
            .ToListAsync(ct);

        return rows.Select(a =>
        {
            var (groups, steps) = GraphJsonHelper.CountNodes(a.GraphJson);
            var isOwner = a.CreatorUserId == userId;
            var canEdit = a.CanEdit || isOwner;
            return new TaskListItemDto
            {
                Id = a.Id,
                Title = a.Title,
                CreatedAtUtc = a.CreatedAtUtc,
                UpdatedAtUtc = a.UpdatedAtUtc == default ? a.CreatedAtUtc : a.UpdatedAtUtc,
                LastEditorUserName = a.LastEditorUserName,
                DataUpdatedAtUtc = a.DataUpdatedAtUtc,
                DataLastEditorUserName = a.DataLastEditorUserName,
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
                SharedWithCount = a.SharedWithCount
            };
        }).ToList();
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
                LastEditorUserName = t.LastEditor != null ? t.LastEditor.UserName : null,
                DataUpdatedAtUtc = t.DataSourceLinks
                    .Select(l => (DateTime?)l.DataSource!.UpdatedAtUtc)
                    .Max(),
                DataLastEditorUserName = t.DataSourceLinks
                    .OrderByDescending(l => l.DataSource!.UpdatedAtUtc)
                    .Select(l => l.DataSource!.LastEditor != null ? l.DataSource.LastEditor.UserName : null)
                    .FirstOrDefault(),
                DataSourceCount = t.DataSourceLinks.Count
            })
            .OrderByDescending(t => t.Id)
            .ToListAsync(ct);

        return rows.Select(t =>
        {
            var (groups, steps) = GraphJsonHelper.CountNodes(t.GraphJson);
            return new TaskListItemDto
            {
                Id = t.Id,
                Title = t.Title,
                CreatedAtUtc = t.CreatedAtUtc,
                UpdatedAtUtc = t.UpdatedAtUtc == default ? t.CreatedAtUtc : t.UpdatedAtUtc,
                LastEditorUserName = t.LastEditorUserName,
                DataUpdatedAtUtc = t.DataUpdatedAtUtc,
                DataLastEditorUserName = t.DataLastEditorUserName,
                GroupCount = groups,
                StepCount = steps,
                DataSourceCount = t.DataSourceCount,
                CanModify = true,
                DesignOrigin = t.DesignOrigin.ToString(),
                OwnerUserName = t.OwnerUserName
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
            TaskTitle = d.LinkedProcessCount == 0
                ? "— (کتابخانه)"
                : d.LinkedProcessTitles,
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

    public async Task<bool> DeleteAsync(int taskId, CancellationToken ct = default)
    {
        // ProcessDataSources links cascade; DataSources library rows are kept (independent entities).
        var process = await _db.Processes.FirstOrDefaultAsync(t => t.Id == taskId, ct);
        if (process is null) return false;
        _db.Processes.Remove(process);
        await _db.SaveChangesAsync(ct);
        return true;
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
    public string Owner { get; set; } = "";
    public string LastEditor { get; set; } = "";
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
}
