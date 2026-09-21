using System.Text.Json;
using DynamicAutomator.Contracts.Recordings;
using DynamicAutomator.Contracts.Tasks;
using DynamicAutomator.Domain.Entities;
using DynamicAutomator.Domain.Enums;
using DynamicAutomator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DynamicAutomator.Infrastructure.Services;

public class TaskService
{
    private readonly AppDbContext _db;

    public TaskService(AppDbContext db) => _db = db;

    public async Task<List<TaskListItemDto>> ListForUserAsync(int userId, CancellationToken ct = default)
    {
        return await _db.UserTaskAccess
            .Where(a => a.UserId == userId)
            .Select(a => new TaskListItemDto
            {
                Id = a.Task.Id,
                Title = a.Task.Title,
                CreatedAtUtc = a.Task.CreatedAtUtc,
                GroupCount = a.Task.Groups.Count,
                StepCount = a.Task.Groups.SelectMany(g => g.Steps).Count(),
                CanModify = a.CanModify || a.Task.CreatorUserId == userId,
                DesignOrigin = a.Task.DesignOrigin.ToString()
            })
            .OrderByDescending(t => t.Id)
            .ToListAsync(ct);
    }

    public async Task<AutomationTask> CreateAsync(int userId, CreateTaskRequest request, CancellationToken ct = default)
    {
        var task = new AutomationTask
        {
            Title = request.Title.Trim(),
            DelayBeforeMs = request.DelayBeforeMs,
            DelayAfterMs = request.DelayAfterMs,
            UseGlobalDataSources = request.UseGlobalDataSources,
            CreatorUserId = userId,
            CreatedAtUtc = DateTime.UtcNow,
            DesignOrigin = Enum.TryParse<TaskDesignOrigin>(request.DesignOrigin, true, out var origin)
                ? origin
                : TaskDesignOrigin.Manual
        };
        task.UserAccess.Add(new UserTaskAccess { UserId = userId, CanModify = true });
        _db.Tasks.Add(task);
        await _db.SaveChangesAsync(ct);
        return task;
    }

    public async Task<bool> CanModifyAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.UserTaskAccess.AnyAsync(a =>
            a.UserId == userId &&
            a.TaskId == taskId &&
            (a.CanModify || a.Task.CreatorUserId == userId), ct);
    }

    public async Task<bool> CanViewAsync(int userId, int taskId, CancellationToken ct = default)
    {
        return await _db.UserTaskAccess.AnyAsync(a => a.UserId == userId && a.TaskId == taskId, ct);
    }
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
