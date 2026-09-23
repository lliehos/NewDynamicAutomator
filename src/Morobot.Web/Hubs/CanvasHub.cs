using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Hubs;

/// <summary>Live canvas edit notifications when a process is open in multiple tabs/browsers.</summary>
[AllowAnonymous]
public class CanvasHub : Hub
{
    public static string TaskGroup(int taskId) => $"canvas-{taskId}";
    public static string TaskGroup(string taskId) => $"canvas-{taskId?.Trim()}";

    public Task JoinTask(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId) || !int.TryParse(taskId.Trim(), out _))
            return Task.CompletedTask;
        return Groups.AddToGroupAsync(Context.ConnectionId, TaskGroup(taskId.Trim()));
    }

    public Task LeaveTask(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return Task.CompletedTask;
        return Groups.RemoveFromGroupAsync(Context.ConnectionId, TaskGroup(taskId.Trim()));
    }
}
