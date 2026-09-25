using System.Collections.Concurrent;

namespace Morobot.Web.Services;

public sealed class PlaySessionInfo
{
    public string TaskId { get; init; } = "";
    public string? UserName { get; init; }
    public int? UserId { get; init; }
    public string? ConnectionId { get; init; }
    public DateTime StartedAtUtc { get; init; } = DateTime.UtcNow;
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
            StartedAtUtc = DateTime.UtcNow
        };
        var isNewStart = !_byTask.ContainsKey(key);
        _byTask[key] = info;
        // Only on a genuine start: re-registering an already-running task (a reconnect, or the
        // panel and the hub both claiming the same task) must not add a second history row.
        if (isNewStart) OnStarted?.Invoke(info);
    }

    public void Unregister(string taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        var key = taskId.Trim();
        _byTask.TryRemove(key, out _);
        _abort.TryRemove(key, out _);
    }

    public bool IsPlaying(string taskId) =>
        !string.IsNullOrWhiteSpace(taskId) && _byTask.ContainsKey(taskId.Trim());

    public PlaySessionInfo? Get(string taskId) =>
        string.IsNullOrWhiteSpace(taskId) ? null
        : _byTask.TryGetValue(taskId.Trim(), out var info) ? info : null;

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

    public IReadOnlyList<PlaySessionInfo> ListPlaying() =>
        _byTask.Values.OrderByDescending(x => x.StartedAtUtc).ToList();
}
