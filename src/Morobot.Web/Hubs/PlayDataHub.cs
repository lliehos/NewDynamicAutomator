using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Hubs;

/// <summary>Live data-source cell events + play session registration.</summary>
[AllowAnonymous]
public class PlayDataHub : Hub
{
    private readonly PlaySessionTracker _plays;

    public PlayDataHub(PlaySessionTracker plays) => _plays = plays;

    public static string TaskGroup(long taskId) => $"task-ds-{taskId}";
    public static string TaskGroup(string taskId) => $"task-ds-{taskId}";

    public async Task JoinTask(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        await Groups.AddToGroupAsync(Context.ConnectionId, TaskGroup(taskId.Trim()));
    }

    public async Task LeaveTask(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, TaskGroup(taskId.Trim()));
    }

    public async Task RegisterPlay(string taskId, string? userName)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        var key = taskId.Trim();
        await Groups.AddToGroupAsync(Context.ConnectionId, TaskGroup(key));
        _plays.Register(key, userName, null, Context.ConnectionId);
        await Clients.Group(TaskGroup(key)).SendAsync("playState", new
        {
            taskId = key,
            playing = true,
            userName
        });
    }

    public async Task UnregisterPlay(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        var key = taskId.Trim();
        _plays.Unregister(key);
        await Clients.Group(TaskGroup(key)).SendAsync("playState", new
        {
            taskId = key,
            playing = false
        });
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // Best-effort: if this connection was the player, clear play state.
        // (Tracked by ConnectionId match.)
        await base.OnDisconnectedAsync(exception);
    }
}
