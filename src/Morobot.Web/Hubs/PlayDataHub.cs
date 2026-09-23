using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Hubs;

/// <summary>Live data-source cell events for the process editor viewer.</summary>
[AllowAnonymous]
public class PlayDataHub : Hub
{
    public static string TaskGroup(long taskId) => $"task-ds-{taskId}";
    public static string TaskGroup(string taskId) => $"task-ds-{taskId}";

    public Task JoinTask(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return Task.CompletedTask;
        return Groups.AddToGroupAsync(Context.ConnectionId, TaskGroup(taskId.Trim()));
    }

    public Task LeaveTask(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return Task.CompletedTask;
        return Groups.RemoveFromGroupAsync(Context.ConnectionId, TaskGroup(taskId.Trim()));
    }
}
