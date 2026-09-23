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
public class PlaySessionTracker
{
    private readonly ConcurrentDictionary<string, PlaySessionInfo> _byTask =
        new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, byte> _abort =
        new(StringComparer.OrdinalIgnoreCase);

    public void Register(string taskId, string? userName, int? userId, string? connectionId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        var key = taskId.Trim();
        _abort.TryRemove(key, out _);
        _byTask[key] = new PlaySessionInfo
        {
            TaskId = key,
            UserName = userName,
            UserId = userId,
            ConnectionId = connectionId,
            StartedAtUtc = DateTime.UtcNow
        };
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
}
