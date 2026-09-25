using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Hubs;

/// <summary>Live data-source cell events + play session registration.</summary>
[AllowAnonymous]
public class PlayDataHub : Hub
{
    private readonly PlaySessionTracker _plays;
    private readonly IHubContext<CatalogHub> _catalog;

    public PlayDataHub(PlaySessionTracker plays, IHubContext<CatalogHub> catalog)
    {
        _plays = plays;
        _catalog = catalog;
    }

    public static string TaskGroup(long taskId) => $"task-ds-{taskId}";
    public static string TaskGroup(string taskId) => $"task-ds-{taskId}";

    /// <summary>
    /// Tell the admin overview that a process started or stopped.
    ///
    /// The admin page listens for "playState" on the catalog hub, not this one: it is watching
    /// every process, not one task, and the catalog hub is where its other live feeds come from.
    /// Nothing was publishing play state there, so the admin's play icons only ever showed what
    /// was true when the page loaded and never reacted to a run starting or finishing.
    /// </summary>
    private Task NotifyCatalog(string taskId, bool playing, string? userName) =>
        _catalog.Clients.Group(CatalogHub.AdminGroup)
            .SendAsync("playState", new { taskId, playing, userName });

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
        await NotifyCatalog(key, true, userName);
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
        await NotifyCatalog(key, false, null);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // Best-effort: if this connection was the player, clear play state.
        // (Tracked by ConnectionId match.)
        await base.OnDisconnectedAsync(exception);
    }
}
