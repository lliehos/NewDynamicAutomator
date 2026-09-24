using Morobot.Contracts.Tasks;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Morobot.Web.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Web.Services;

public class CatalogLiveService
{
    private readonly IHubContext<CatalogHub> _hub;
    private readonly AppDbContext _db;
    private readonly TaskService _tasks;

    public CatalogLiveService(IHubContext<CatalogHub> hub, AppDbContext db, TaskService tasks)
    {
        _hub = hub;
        _db = db;
        _tasks = tasks;
    }

    public async Task TaskUpsertedAsync(TaskListItemDto item, string action, string? actorUserName, CancellationToken ct = default)
    {
        var recipients = await ResolveAccessUserIdsAsync(item.Id, ct);
        var payload = new { action, actorUserName, task = item };
        if (recipients.Count > 0)
            await SendToUsersAsync("taskChanged", payload, recipients, ct);
        await NotifyAdminsAsync("taskChanged", payload, ct);
    }

    /// <summary>Push per-user list rows after linked data-source cell/metadata changes.</summary>
    public async Task BroadcastProcessListItemAsync(int processId, string action, string? actorUserName, CancellationToken ct = default)
    {
        var recipients = await ResolveAccessUserIdsAsync(processId, ct);
        foreach (var uid in recipients.Distinct())
        {
            var list = await _tasks.ListForUserAsync(uid, ct);
            var item = list.FirstOrDefault(x => x.Id == processId);
            if (item is null) continue;
            var payload = new { action, actorUserName, task = item };
            await SendToUsersAsync("taskChanged", payload, new[] { uid }, ct);
        }

        var adminItem = (await _tasks.ListAllForAdminAsync(ct)).FirstOrDefault(x => x.Id == processId);
        if (adminItem is not null)
            await NotifyAdminsAsync("taskChanged", new { action, actorUserName, task = adminItem }, ct);
    }

    public async Task TaskDeletedAsync(
        int taskId, IReadOnlyList<int> recipientUserIds, string? actorUserName, CancellationToken ct = default)
    {
        var payload = new { action = "deleted", actorUserName, task = new { id = taskId } };
        if (recipientUserIds.Count > 0)
            await SendToUsersAsync("taskChanged", payload, recipientUserIds, ct);
        await NotifyAdminsAsync("taskChanged", payload, ct);
    }

    public async Task SourceChangedAsync(int taskId, object sourceSummary, string action, string? actorUserName, CancellationToken ct = default)
    {
        var recipients = await ResolveAccessUserIdsAsync(taskId, ct);
        var payload = new { action, actorUserName, taskId, source = sourceSummary };
        if (recipients.Count > 0)
            await SendToUsersAsync("sourceChanged", payload, recipients, ct);
        await NotifyAdminsAsync("sourceChanged", payload, ct);
    }

    /// <summary>Library-level source events (create / rename / delete) — always to admins; owner if known.</summary>
    public async Task LibrarySourceChangedAsync(
        object sourceSummary, string action, string? actorUserName, int? ownerUserId = null, CancellationToken ct = default)
    {
        var payload = new { action, actorUserName, taskId = (int?)null, source = sourceSummary };
        if (ownerUserId is int oid && oid > 0)
            await SendToUsersAsync("sourceChanged", payload, new[] { oid }, ct);
        await NotifyAdminsAsync("sourceChanged", payload, ct);
    }

    public Task NotifyPlayStateAsync(string taskId, bool playing, string? userName, CancellationToken ct = default)
    {
        var payload = new { taskId, playing, userName };
        return NotifyAdminsAsync("playState", payload, ct);
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

    private Task NotifyAdminsAsync(string method, object payload, CancellationToken ct)
        => _hub.Clients.Group(CatalogHub.AdminGroup).SendAsync(method, payload, ct);

    private Task SendToUsersAsync(string method, object payload, IEnumerable<int> userIds, CancellationToken ct)
    {
        var groups = userIds.Distinct().Select(CatalogHub.UserGroup).ToList();
        if (groups.Count == 0) return Task.CompletedTask;
        return _hub.Clients.Groups(groups).SendAsync(method, payload, ct);
    }
}
