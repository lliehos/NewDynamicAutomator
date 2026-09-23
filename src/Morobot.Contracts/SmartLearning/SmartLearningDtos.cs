using System.Text.Json;

namespace Morobot.Contracts.SmartLearning;

public sealed class StartSmartSessionRequest
{
    public long TaskId { get; set; }
    public string? TaskTitle { get; set; }
    public string? LocalUser { get; set; }
}

public sealed class StartSmartSessionResponse
{
    public string SessionId { get; set; } = "";
    public long TaskId { get; set; }
    public bool LearningComplete { get; set; }
    public string Status { get; set; } = "thinking";
}

public sealed class AppendSmartContextsRequest
{
    public List<JsonElement> Contexts { get; set; } = new();
}

public sealed class AppendSmartContextsResponse
{
    public bool Ok { get; set; } = true;
    public int Accepted { get; set; }
    public int TotalContexts { get; set; }
    public bool LearningComplete { get; set; }
}

public sealed class SmartSessionStatusResponse
{
    public string SessionId { get; set; } = "";
    public long TaskId { get; set; }
    public string? TaskTitle { get; set; }
    public string? LocalUser { get; set; }
    public string Status { get; set; } = "idle";
    public bool LearningComplete { get; set; }
    public int ContextCount { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset? StoppedAtUtc { get; set; }
    /// <summary>Filled later when learning produces a process graph — currently always null.</summary>
    public object? SuggestedGraph { get; set; }
}

public sealed class SmartSessionStopResponse
{
    public bool Ok { get; set; } = true;
    public bool LearningComplete { get; set; }
    public int ContextCount { get; set; }
    public string Status { get; set; } = "stopped";
}

public sealed class SmartSessionSaveResponse
{
    public bool Ok { get; set; }
    public string? Message { get; set; }
    public long? TaskId { get; set; }
    public object? Graph { get; set; }
}
