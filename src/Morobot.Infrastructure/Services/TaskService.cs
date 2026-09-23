using System.Text.Json;
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

    public TaskService(AppDbContext db, EntitlementService entitlements)
    {
        _db = db;
        _entitlements = entitlements;
    }

    public async Task<List<TaskListItemDto>> ListForUserAsync(int userId, CancellationToken ct = default)
    {
        var entitlementsUser = await _db.Users.AsNoTracking().Include(u => u.Plan)
            .FirstOrDefaultAsync(u => u.Id == userId, ct);
        var canSharePlan = entitlementsUser?.Plan?.CanShare == true
                           && !(entitlementsUser.Plan != null && PasswordPolicy.IsLocal(entitlementsUser.Plan.Code));

        var list = await _db.UserTaskAccess
            .Where(a => a.UserId == userId)
            .Select(a => new TaskListItemDto
            {
                Id = a.Task.Id,
                Title = a.Task.Title,
                CreatedAtUtc = a.Task.CreatedAtUtc,
                GroupCount = a.Task.Groups.Count,
                StepCount = a.Task.Groups.SelectMany(g => g.Steps).Count(),
                IsOwner = a.Task.CreatorUserId == userId,
                CanView = true,
                CanEdit = a.CanEdit || a.CanModify || a.Task.CreatorUserId == userId,
                CanModify = a.CanEdit || a.CanModify || a.Task.CreatorUserId == userId,
                CanDelete = a.CanDelete || a.Task.CreatorUserId == userId,
                CanExecute = a.CanExecute || a.Task.CreatorUserId == userId,
                CanChangeDataSource = a.CanChangeDataSource || a.CanEdit || a.CanModify || a.Task.CreatorUserId == userId,
                CanShare = canSharePlan && (a.Task.CreatorUserId == userId || a.CanEdit || a.CanModify),
                DesignOrigin = a.Task.DesignOrigin.ToString(),
                OwnerUserName = a.Task.Creator != null ? a.Task.Creator.UserName : null,
                SharedWithCount = a.Task.UserAccess.Count(x => x.UserId != a.Task.CreatorUserId)
            })
            .OrderByDescending(t => t.Id)
            .ToListAsync(ct);

        await FillDataSourceCountsAsync(list, ct);
        return list;
    }

    public async Task<List<TaskListItemDto>> ListAllForAdminAsync(CancellationToken ct = default)
    {
        var list = await _db.Tasks
            .Select(t => new TaskListItemDto
            {
                Id = t.Id,
                Title = t.Title,
                CreatedAtUtc = t.CreatedAtUtc,
                GroupCount = t.Groups.Count,
                StepCount = t.Groups.SelectMany(g => g.Steps).Count(),
                CanModify = true,
                DesignOrigin = t.DesignOrigin.ToString(),
                OwnerUserName = t.Creator != null ? t.Creator.UserName : null
            })
            .OrderByDescending(t => t.Id)
            .ToListAsync(ct);
        await FillDataSourceCountsAsync(list, ct);
        return list;
    }

    private async Task FillDataSourceCountsAsync(List<TaskListItemDto> list, CancellationToken ct)
    {
        if (list.Count == 0) return;
        var ids = list.Select(x => x.Id).ToList();
        var canvases = await _db.Tasks.AsNoTracking()
            .Where(t => ids.Contains(t.Id))
            .Select(t => new { t.Id, t.CanvasJson })
            .ToListAsync(ct);
        var map = canvases.ToDictionary(x => x.Id, x => EntitlementService.CountSourcesInCanvasJson(x.CanvasJson));
        foreach (var item in list)
            item.DataSourceCount = map.GetValueOrDefault(item.Id);
    }

    /// <summary>Flatten canvas-embedded data sources for admin oversight.</summary>
    public async Task<List<AdminCanvasSourceRow>> ListCanvasSourcesForAdminAsync(CancellationToken ct = default)
    {
        var tasks = await _db.Tasks.AsNoTracking()
            .Include(t => t.Creator)
            .Select(t => new { t.Id, t.Title, Owner = t.Creator != null ? t.Creator.UserName : "—", t.CanvasJson })
            .ToListAsync(ct);
        var rows = new List<AdminCanvasSourceRow>();
        foreach (var t in tasks)
        {
            if (string.IsNullOrWhiteSpace(t.CanvasJson)) continue;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(t.CanvasJson);
                if (!doc.RootElement.TryGetProperty("dataSources", out var arr)
                    && !doc.RootElement.TryGetProperty("DataSources", out arr))
                    continue;
                if (arr.ValueKind != System.Text.Json.JsonValueKind.Array) continue;
                foreach (var el in arr.EnumerateArray())
                {
                    var id = el.TryGetProperty("id", out var idEl) ? idEl.ToString()
                        : el.TryGetProperty("Id", out var idEl2) ? idEl2.ToString() : "?";
                    var title = el.TryGetProperty("title", out var te) ? te.GetString()
                        : el.TryGetProperty("Title", out var te2) ? te2.GetString() : null;
                    title ??= el.TryGetProperty("fileName", out var fn) ? fn.GetString() : "منبع";
                    var cols = 0;
                    if (el.TryGetProperty("columnCount", out var cc) && cc.TryGetInt32(out var cci)) cols = cci;
                    else if (el.TryGetProperty("columnKeys", out var ck) && ck.ValueKind == System.Text.Json.JsonValueKind.Array)
                        cols = ck.GetArrayLength();
                    var rowCount = 0;
                    if (el.TryGetProperty("rowCount", out var rc) && rc.TryGetInt32(out var rci)) rowCount = rci;
                    rows.Add(new AdminCanvasSourceRow
                    {
                        SourceId = id ?? "?",
                        Title = title ?? "منبع",
                        TaskId = t.Id,
                        TaskTitle = t.Title,
                        Owner = t.Owner ?? "—",
                        ColumnCount = cols,
                        RowCount = rowCount
                    });
                }
            }
            catch { /* ignore bad json */ }
        }
        return rows.OrderByDescending(r => r.TaskId).ToList();
    }

    public async Task<AutomationTask> CreateAsync(int userId, CreateTaskRequest request, CancellationToken ct = default)
        => await CreateAsync(userId, request, entitlements: null, ct);

    public async Task<AutomationTask> CreateAsync(int userId, CreateTaskRequest request, EntitlementsDto? entitlements, CancellationToken ct)
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

        var task = new AutomationTask
        {
            Title = request.Title.Trim(),
            DelayBeforeMs = request.DelayBeforeMs,
            DelayAfterMs = request.DelayAfterMs,
            UseGlobalDataSources = request.UseGlobalDataSources,
            CreatorUserId = userId > 0 ? userId : null,
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow,
            DesignOrigin = Enum.TryParse<TaskDesignOrigin>(request.DesignOrigin, true, out var origin)
                ? origin
                : TaskDesignOrigin.Manual
        };
        if (userId > 0)
        {
            task.UserAccess.Add(new UserTaskAccess
            {
                UserId = userId,
                CanModify = true,
                CanView = true,
                CanEdit = true,
                CanDelete = true,
                CanExecute = true,
                CanChangeDataSource = true,
                GrantedAtUtc = DateTime.UtcNow,
                GrantedByUserId = userId
            });
        }
        _db.Tasks.Add(task);
        await _db.SaveChangesAsync(ct);
        return task;
    }

    public async Task<bool> DeleteAsync(int taskId, CancellationToken ct = default)
    {
        var task = await _db.Tasks.FirstOrDefaultAsync(t => t.Id == taskId, ct);
        if (task is null) return false;
        _db.Tasks.Remove(task);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> CanModifyAsync(int userId, int taskId, CancellationToken ct = default)
        => await CanEditAsync(userId, taskId, ct);

    public async Task<bool> CanEditAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.UserTaskAccess.AnyAsync(a =>
            a.UserId == userId &&
            a.TaskId == taskId &&
            (a.CanEdit || a.CanModify || a.Task.CreatorUserId == userId), ct);
    }

    public async Task<bool> CanDeleteAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.UserTaskAccess.AnyAsync(a =>
            a.UserId == userId &&
            a.TaskId == taskId &&
            (a.CanDelete || a.Task.CreatorUserId == userId), ct);
    }

    public async Task<bool> CanExecuteAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.UserTaskAccess.AnyAsync(a =>
            a.UserId == userId &&
            a.TaskId == taskId &&
            (a.CanExecute || a.Task.CreatorUserId == userId), ct);
    }

    public async Task<bool> CanChangeDataSourceAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.UserTaskAccess.AnyAsync(a =>
            a.UserId == userId &&
            a.TaskId == taskId &&
            (a.CanChangeDataSource || a.CanEdit || a.CanModify || a.Task.CreatorUserId == userId), ct);
    }

    public async Task<bool> CanViewAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.UserTaskAccess.AnyAsync(a => a.UserId == userId && a.TaskId == taskId, ct);
    }

    public async Task<(string? json, DateTime updatedAtUtc)?> GetCanvasAsync(int userId, int taskId, CancellationToken ct = default)
    {
        if (!await CanViewAsync(userId, taskId, ct))
            return null;
        var row = await _db.Tasks.AsNoTracking()
            .Where(t => t.Id == taskId)
            .Select(t => new { t.CanvasJson, t.UpdatedAtUtc, t.CreatedAtUtc })
            .FirstOrDefaultAsync(ct);
        if (row is null) return null;
        var updated = row.UpdatedAtUtc == default ? row.CreatedAtUtc : row.UpdatedAtUtc;
        return (row.CanvasJson, DateTime.SpecifyKind(updated, DateTimeKind.Utc));
    }

    public async Task<string?> GetCanvasJsonAsync(int userId, int taskId, CancellationToken ct = default)
    {
        var hit = await GetCanvasAsync(userId, taskId, ct);
        return hit?.json;
    }

    public async Task<(bool ok, string? error, DateTime? updatedAtUtc)> SaveCanvasJsonAsync(
        int userId, int taskId, string canvasJson, string? title,
        DateTime? baseUpdatedAtUtc = null, EntitlementsDto? entitlements = null, CancellationToken ct = default)
    {
        if (!await CanModifyAsync(userId, taskId, ct))
            return (false, "forbidden", null);
        var task = await _db.Tasks.FirstOrDefaultAsync(t => t.Id == taskId, ct);
        if (task is null) return (false, "notfound", null);

        var currentUpdated = task.UpdatedAtUtc == default ? task.CreatedAtUtc : task.UpdatedAtUtc;
        if (baseUpdatedAtUtc.HasValue)
        {
            // DB stores UTC wall-clock as Unspecified; never use ToUniversalTime on Unspecified
            // (that treats it as local and shifts by timezone — e.g. +03:30 → false conflict).
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
            var otherJsons = await _db.Tasks
                .Where(t => t.Id != taskId && (t.CreatorUserId == userId || t.UserAccess.Any(a => a.UserId == userId)))
                .Select(t => t.CanvasJson)
                .ToListAsync(ct);
            var other = otherJsons.Sum(EntitlementService.CountSourcesInCanvasJson);
            var relational = await _db.DataSources.CountAsync(d => d.UserId == userId, ct);
            var inThis = EntitlementService.CountSourcesInCanvasJson(canvasJson);
            if (other + relational + inThis > maxSrc)
                return (false, $"Data source limit reached ({maxSrc}).", null);
        }

        task.CanvasJson = canvasJson;
        if (!string.IsNullOrWhiteSpace(title))
            task.Title = title.Trim();
        task.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return (true, null, DateTime.SpecifyKind(task.UpdatedAtUtc, DateTimeKind.Utc));
    }

    /// <summary>Treat Unspecified as already-UTC (SQL datetime2); convert Local → UTC.</summary>
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
    private readonly AppDbContext _db;
    private readonly TaskService _tasks;

    public RecordingService(AppDbContext db, TaskService tasks)
    {
        _db = db;
        _tasks = tasks;
    }

    public async Task<SaveRecordingResponse> SaveAsync(int userId, SaveRecordingRequest request, CancellationToken ct = default)
    {
        AutomationTask task;
        if (request.TaskId is int taskId)
        {
            if (!await _tasks.CanModifyAsync(userId, taskId, ct))
                throw new UnauthorizedAccessException("No modify access to this task.");
            task = await _db.Tasks.FirstAsync(t => t.Id == taskId, ct);
            task.DesignOrigin = TaskDesignOrigin.Recorded;
        }
        else
        {
            var title = string.IsNullOrWhiteSpace(request.NewTaskTitle)
                ? $"ضبط {DateTime.Now:yyyy-MM-dd HH:mm}"
                : request.NewTaskTitle.Trim();
            task = await _tasks.CreateAsync(userId, new CreateTaskRequest
            {
                Title = title,
                DesignOrigin = nameof(TaskDesignOrigin.Recorded)
            }, ct);
        }

        var group = new Group
        {
            TaskId = task.Id,
            Title = string.IsNullOrWhiteSpace(request.GroupTitle) ? "ضبط‌شده" : request.GroupTitle.Trim(),
            Priority = await _db.Groups.Where(g => g.TaskId == task.Id).Select(g => (int?)g.Priority).MaxAsync(ct) ?? 0
        };
        group.Priority += 1;
        _db.Groups.Add(group);
        await _db.SaveChangesAsync(ct);

        var priority = 1;
        foreach (var item in request.Actions)
        {
            var selector = new Selector
            {
                ElementBy = ParseBy(item.ElementBy),
                ElementValue = item.ElementValue,
                FramePathJson = JsonSerializer.Serialize(item.FramePath)
            };
            _db.Selectors.Add(selector);

            var action = new StepAction
            {
                ActionType = ParseAction(item.ActionType),
                ConstantValue = item.Value,
                NavigateUrl = item.ActionType.Equals("GoToUrl", StringComparison.OrdinalIgnoreCase) ? item.Url : null,
                Selector = selector
            };
            _db.Actions.Add(action);

            _db.Steps.Add(new Step
            {
                GroupId = group.Id,
                Title = $"{action.ActionType} {priority}",
                Priority = priority,
                Action = action,
                IsActive = true
            });
            priority++;
        }

        await _db.SaveChangesAsync(ct);
        return new SaveRecordingResponse
        {
            TaskId = task.Id,
            GroupId = group.Id,
            StepCount = request.Actions.Count
        };
    }

    private static SelectorBy ParseBy(string value) =>
        Enum.TryParse<SelectorBy>(value, true, out var by) ? by : SelectorBy.CssSelector;

    private static ActionType ParseAction(string value) =>
        Enum.TryParse<ActionType>(value, true, out var t) ? t : ActionType.Click;
}

public class AdminCanvasSourceRow
{
    public string SourceId { get; set; } = "";
    public string Title { get; set; } = "";
    public int TaskId { get; set; }
    public string TaskTitle { get; set; } = "";
    public string Owner { get; set; } = "";
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
}
