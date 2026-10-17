using Webautomator.Domain;
using Webautomator.Infrastructure.Services;
using Webautomator.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Security.Claims;

namespace Webautomator.Web.Hubs;

/// <summary>Live data-source cell events + play session registration.</summary>
[AllowAnonymous]
public class PlayDataHub : Hub
{
    private readonly PlaySessionTracker _plays;
    private readonly IHubContext<CatalogHub> _catalog;
    private readonly SystemSettingsService _settings;

    public PlayDataHub(PlaySessionTracker plays, IHubContext<CatalogHub> catalog, SystemSettingsService settings)
    {
        _plays = plays;
        _catalog = catalog;
        _settings = settings;
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

        // Same gate as the HTTP registration path: while the stop-all switch is on, a run cannot become
        // a server-side run, so an open tab cannot simply start it again.
        if (await _settings.GetBoolAsync(SystemSettingKeys.StopAllServerRuns, false, CancellationToken.None))
            throw new HubException("runs_suspended");

        var key = taskId.Trim();
        await Groups.AddToGroupAsync(Context.ConnectionId, TaskGroup(key));
        // The connection may be authenticated (the panel connects with the access token on the query
        // string). Registering it as anonymous would put a signed-in user's run on the dashboard's
        // "unauthenticated" row, where none of the per-user controls can reach it.
        var uid = int.TryParse(Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var parsedUid)
            && parsedUid > 0
            ? parsedUid
            : (int?)null;
        var identityName = string.IsNullOrWhiteSpace(userName) ? Context.User?.Identity?.Name : userName;
        _plays.Register(key, identityName, uid, Context.ConnectionId);
        await Clients.Group(TaskGroup(key)).SendAsync("playState", new
        {
            taskId = key,
            playing = true,
            userName = identityName
        });
        await NotifyCatalog(key, true, identityName);
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
