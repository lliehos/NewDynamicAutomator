using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Webautomator.Domain.Entities;
using Webautomator.Infrastructure.Persistence;
using Webautomator.Web.Hubs;

namespace Webautomator.Web.Services;

/// <summary>Whether a token may still be used, and why not when it may not.</summary>
public enum SessionVerdict
{
    /// <summary>The token matches the account's current session version.</summary>
    Valid,
    /// <summary>A newer sign-in replaced it (the single-session rule, or another device).</summary>
    Superseded,
    /// <summary>A monitoring administrator closed it.</summary>
    Closed
}

/// <summary>
/// Ends a user's sessions on demand, and answers whether a token is still accepted.
/// </summary>
/// <remarks>
/// The mechanism is the one the product already had for single-session enforcement: every token
/// carries the account's <c>SessionVersion</c> at the moment it was minted, and a higher stored value
/// makes the token stale. This service adds the missing half — an ADMINISTRATOR can bump that version
/// — and makes the check unconditional, because until now it only ran on deployments whose licence
/// enforces one session, which would have left "close this session" doing nothing on every other
/// install.
///
/// The stored version is cached for a few seconds rather than read per request: the check has to be
/// free for pages that never change it, and a few seconds of staleness is invisible next to the client
/// poll that follows. Closing a session evicts the cache entry, so the very next request is rejected
/// even on the node that did the closing.
/// </remarks>
public sealed class SessionGuard
{
    /// <summary>How long a stored version may be reused without asking the database again.</summary>
    private static readonly TimeSpan VersionTtl = TimeSpan.FromSeconds(30);

    /// <summary>How long a closure is remembered for the failure it produces.</summary>
    /// <remarks>
    /// Only the MESSAGE depends on this: the rejected token is rejected either way, because the stored
    /// version moved. After a restart the same token is refused as "superseded" instead of "closed",
    /// which is a wording detail rather than a security one; the audit log keeps the real reason.
    /// </remarks>
    private static readonly TimeSpan ClosureMemory = TimeSpan.FromHours(24);

    private const string VersionKeyPrefix = "session-version:";

    private readonly IServiceScopeFactory _scopes;
    private readonly IMemoryCache _cache;
    private readonly IHubContext<CatalogHub> _catalog;
    private readonly ILogger<SessionGuard> _log;

    /// <summary>User ids closed by an administrator, so the rejection can say why.</summary>
    private readonly System.Collections.Concurrent.ConcurrentDictionary<int, DateTime> _closed = new();

    public SessionGuard(
        IServiceScopeFactory scopes,
        IMemoryCache cache,
        IHubContext<CatalogHub> catalog,
        ILogger<SessionGuard> log)
    {
        _scopes = scopes;
        _cache = cache;
        _catalog = catalog;
        _log = log;
    }

    /// <summary>Decide whether a token is still good for this account.</summary>
    public async Task<SessionVerdict> EvaluateAsync(int userId, int tokenVersion, CancellationToken ct = default)
    {
        if (userId <= 0) return SessionVerdict.Valid;

        var stored = await StoredVersionAsync(userId, ct);
        if (stored is null || stored.Value == tokenVersion) return SessionVerdict.Valid;

        Prune();
        return _closed.ContainsKey(userId) ? SessionVerdict.Closed : SessionVerdict.Superseded;
    }

    /// <summary>
    /// End every session of one account: its tokens stop being accepted, and the connections it has
    /// open right now are told to go away.
    /// </summary>
    /// <remarks>
    /// The live link is ASKED to close rather than torn down, because a SignalR connection established
    /// before the closure is not re-authenticated per message — the honest sequence is that the token
    /// is dead from this moment (every new request, hub call and reconnect is refused) while the client
    /// is told, so it can stop cleanly instead of appearing to work until its next call fails.
    /// </remarks>
    public async Task<int> CloseAsync(int userId, string? actorName, string reason, CancellationToken ct = default)
    {
        if (userId <= 0) return 0;

        int bumped;
        using (var scope = _scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
            if (user is null) return 0;

            user.SessionVersion += 1;
            bumped = user.SessionVersion;

            db.EventLogs.Add(new AppEventLog
            {
                Level = "Audit",
                Category = "Auth",
                EventType = "SessionClosedByAdmin",
                Message = $"Session(s) closed for {user.UserName} by the monitoring administrator",
                UserId = userId,
                UserName = user.UserName,
                DetailsJson = System.Text.Json.JsonSerializer.Serialize(new { actor = actorName, reason }),
                CreatedAtUtc = DateTime.UtcNow
            });

            await db.SaveChangesAsync(ct);
        }

        // The cache holds the OLD version on purpose (it was valid a moment ago); dropping it is what
        // makes this node reject the very next request rather than up to a TTL later.
        _cache.Remove(VersionKeyPrefix + userId);
        _closed[userId] = DateTime.UtcNow;

        try
        {
            await _catalog.Clients.Group(CatalogHub.UserGroup(userId))
                .SendAsync("sessionEnded", new { reason }, ct);
        }
        catch (Exception ex)
        {
            // A client that cannot be told still loses its token, so this is not a failure of the
            // action — only of the courtesy.
            _log.LogWarning(ex, "Could not notify user {UserId} that the session was closed", userId);
        }

        return bumped;
    }

    private async Task<int?> StoredVersionAsync(int userId, CancellationToken ct)
    {
        var key = VersionKeyPrefix + userId;
        if (_cache.TryGetValue(key, out int cached)) return cached;

        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stored = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => (int?)u.SessionVersion)
            .FirstOrDefaultAsync(ct);

        if (stored is int version) _cache.Set(key, version, VersionTtl);
        return stored;
    }

    /// <summary>Forget closures nobody can still be holding a token from.</summary>
    private void Prune()
    {
        if (_closed.Count < 256) return;
        var cutoff = DateTime.UtcNow - ClosureMemory;
        foreach (var entry in _closed.Where(e => e.Value < cutoff).ToList())
            _closed.TryRemove(entry.Key, out _);
    }
}
