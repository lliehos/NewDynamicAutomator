using System.Security.Claims;
using Morobot.Contracts.Tasks;
using Morobot.Infrastructure.Persistence;
using Morobot.Web.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Web.Services;

public class CatalogLiveService
{
    private readonly IHubContext<CatalogHub> _hub;
    private readonly AppDbContext _db;

    public CatalogLiveService(IHubContext<CatalogHub> hub, AppDbContext db)
    {
        _hub = hub;
        _db = db;
    }

    public async Task TaskUpsertedAsync(TaskListItemDto item, string action, string? actorUserName, CancellationToken ct = default)
    {
        var recipients = await ResolveAccessUserIdsAsync(item.Id, ct);
        if (recipients.Count == 0) return;
        var payload = new { action, actorUserName, task = item };
        await SendToUsersAsync("taskChanged", payload, recipients, ct);
    }

    public async Task TaskDeletedAsync(
        int taskId, IReadOnlyList<int> recipientUserIds, string? actorUserName, CancellationToken ct = default)
    {
        if (recipientUserIds.Count == 0) return;
        var payload = new { action = "deleted", actorUserName, task = new { id = taskId } };
        await SendToUsersAsync("taskChanged", payload, recipientUserIds, ct);
    }

    public async Task SourceChangedAsync(int taskId, object sourceSummary, string action, string? actorUserName, CancellationToken ct = default)
    {
        var recipients = await ResolveAccessUserIdsAsync(taskId, ct);
        if (recipients.Count == 0) return;
        var payload = new { action, actorUserName, taskId, source = sourceSummary };
        await SendToUsersAsync("sourceChanged", payload, recipients, ct);
    }

    public async Task<List<int>> ResolveAccessUserIdsAsync(int processId, CancellationToken ct = default)
    {
        var shareIds = await _db.ProcessShares.AsNoTracking()
            .Where(s => s.ProcessId == processId)
            .Select(s => s.UserId)
            .ToListAsync(ct);
        var creatorId = await _db.Processes.AsNoTracking()
            .Where(p => p.Id == processId)
            .Select(p => p.CreatorUserId)
            .FirstOrDefaultAsync(ct);
        if (creatorId is int cid && !shareIds.Contains(cid))
            shareIds.Add(cid);
        return shareIds;
    }

    private Task SendToUsersAsync(string method, object payload, IEnumerable<int> userIds, CancellationToken ct)
    {
        var groups = userIds.Distinct().Select(CatalogHub.UserGroup).ToList();
        if (groups.Count == 0) return Task.CompletedTask;
        return _hub.Clients.Groups(groups).SendAsync(method, payload, ct);
    }
}
