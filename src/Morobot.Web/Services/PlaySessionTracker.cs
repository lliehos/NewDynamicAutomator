using System.Collections.Concurrent;

namespace Morobot.Web.Services;

public sealed class PlaySessionInfo
{
    public string TaskId { get; init; } = "";
    public string? UserName { get; init; }
    public int? UserId { get; init; }
    public string? ConnectionId { get; init; }
    public DateTime StartedAtUtc { get; init; } = DateTime.UtcNow;

    /// <summary>
    /// When this session last proved it was still alive. Refreshed by the client's own abort poll.
    /// </summary>
    public DateTime LastSeenAtUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>Tracks processes currently being executed (play) across browsers.</summary>
/// <remarks>
/// Sessions are held in memory only, so this tracker knows what is running right now but not
/// what ran yesterday. Anything that needs play <em>history</em> - the dashboard's activity
/// trend, for example - has to come from somewhere durable, which is what <see cref="OnStarted"/>
/// is for: the tracker reports the start and whoever owns the durable store (the event log)
/// records it. Keeping the callback here rather than at each call site means a new way to start
/// a play cannot forget to record it.
/// </remarks>
public class PlaySessionTracker
{
    /// <summary>
    /// How long a session may go without a liveness refresh before it is treated as dead.
    /// </summary>
    /// <remarks>
    /// A run registers when it starts and unregisters when it ends, but the end is not guaranteed to
    /// arrive: closing the tab kills the extension's abort poll mid-flight, and a terminated MV3
    /// worker never sends its final round-trip. The tracker then kept that task "playing" forever —
    /// an in-memory entry with no expiry — and every later save of that process was refused with a
    /// 409 telling the user a run was in progress when nothing was running. The client-side
    /// heartbeat could not help: it only ever cleared the extension's own storage, never this
    /// server state.
    ///
    /// Expiry is the honest correction, because the client's abort poll ticks every 1.5s while a run
    /// is genuinely alive (see PlayAbort in TasksController), so a session that stops polling really
    /// has stopped running. The window is deliberately generous — several missed ticks — so a slow
    /// network or a paused run is never mistaken for an abandoned one.
    /// </remarks>
    private static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(30);

    private readonly ConcurrentDictionary<string, PlaySessionInfo> _byTask =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, byte> _abort =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Raised once each time a session is registered. Fired on the registering thread, so the
    /// handler must not block; it is expected to hand off to a background write.
    /// </summary>
    public event Action<PlaySessionInfo>? OnStarted;

    public void Register(string taskId, string? userName, int? userId, string? connectionId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        var key = taskId.Trim();
        _abort.TryRemove(key, out _);
        var info = new PlaySessionInfo
        {
            TaskId = key,
            UserName = userName,
            UserId = userId,
            ConnectionId = connectionId,
            StartedAtUtc = DateTime.UtcNow,
            LastSeenAtUtc = DateTime.UtcNow
        };
        var isNewStart = !_byTask.ContainsKey(key);
        _byTask[key] = info;
        // Only on a genuine start: re-registering an already-running task (a reconnect, or the
        // panel and the hub both claiming the same task) must not add a second history row.
        if (isNewStart) OnStarted?.Invoke(info);
    }

    /// <summary>
    /// Mark a session as still alive. Called by the client's periodic abort poll, which is the one
    /// signal an actively running session emits without fail.
    /// </summary>
    public void Touch(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        if (_byTask.TryGetValue(taskId.Trim(), out var info))
            info.LastSeenAtUtc = DateTime.UtcNow;
    }

    /// <summary>
    /// Drop a session that has stopped reporting in. Returns true when the entry was stale and is
    /// now gone, which tells the caller the change is worth broadcasting.
    /// </summary>
    public bool PruneIfStale(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return false;
        var key = taskId.Trim();
        if (!_byTask.TryGetValue(key, out var info)) return false;
        if (DateTime.UtcNow - info.LastSeenAtUtc < StaleAfter) return false;
        // TryRemove may lose a race with a re-register; only report the prune if this call removed
        // the entry it judged stale, so a freshly restarted run is never announced as finished.
        return _byTask.TryRemove(new KeyValuePair<string, PlaySessionInfo>(key, info));
    }

    public void Unregister(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        var key = taskId.Trim();
        _byTask.TryRemove(key, out _);
        _abort.TryRemove(key, out _);
    }

    public bool IsPlaying(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return false;
        var key = taskId.Trim();
        if (!_byTask.TryGetValue(key, out var info)) return false;
        // An abandoned session must not block saves; prune it lazily on first sight.
        if (DateTime.UtcNow - info.LastSeenAtUtc >= StaleAfter)
        {
            _byTask.TryRemove(new KeyValuePair<string, PlaySessionInfo>(key, info));
            return false;
        }
        return true;
    }

    public PlaySessionInfo? Get(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return null;
        var key = taskId.Trim();
        if (!_byTask.TryGetValue(key, out var info)) return null;
        if (DateTime.UtcNow - info.LastSeenAtUtc >= StaleAfter)
        {
            _byTask.TryRemove(new KeyValuePair<string, PlaySessionInfo>(key, info));
            return null;
        }
        return info;
    }

    public void RequestAbort(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        _abort[taskId.Trim()] = 1;
    }

    public bool ConsumeAbort(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return false;
        return _abort.TryRemove(taskId.Trim(), out _);
    }

    public bool PeekAbort(string taskId) =>
        !string.IsNullOrWhiteSpace(taskId) && _abort.ContainsKey(taskId.Trim());

    public IReadOnlyList<PlaySessionInfo> ListPlaying()
    {
        var cutoff = DateTime.UtcNow - StaleAfter;
        var result = new List<PlaySessionInfo>();
        foreach (var kvp in _byTask)
        {
            if (kvp.Value.LastSeenAtUtc < cutoff)
            {
                _byTask.TryRemove(kvp);
                continue;
            }
            result.Add(kvp.Value);
        }
        return result.OrderByDescending(x => x.StartedAtUtc).ToList();
    }
}
