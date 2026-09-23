using Morobot.Contracts.Tasks;
using Morobot.Web.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Services;

public class CatalogLiveService
{
    private readonly IHubContext<CatalogHub> _hub;

    public CatalogLiveService(IHubContext<CatalogHub> hub) => _hub = hub;

    public Task TaskUpsertedAsync(TaskListItemDto item, string action, string? actorUserName, CancellationToken ct = default)
        => _hub.Clients.Group(CatalogHub.GroupName).SendAsync("taskChanged", new
        {
            action, // created | updated | shared
            actorUserName,
            task = item
        }, ct);

    public Task TaskDeletedAsync(int taskId, string? actorUserName, CancellationToken ct = default)
        => _hub.Clients.Group(CatalogHub.GroupName).SendAsync("taskChanged", new
        {
            action = "deleted",
            actorUserName,
            task = new { id = taskId }
        }, ct);

    public Task SourceChangedAsync(int taskId, object sourceSummary, string action, string? actorUserName, CancellationToken ct = default)
        => _hub.Clients.Group(CatalogHub.GroupName).SendAsync("sourceChanged", new
        {
            action,
            actorUserName,
            taskId,
            source = sourceSummary
        }, ct);
}
