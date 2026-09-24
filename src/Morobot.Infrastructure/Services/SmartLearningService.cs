using System.Text.Json;
using Morobot.Contracts.SmartLearning;
using Morobot.Infrastructure.Options;
using Microsoft.Extensions.Options;

namespace Morobot.Infrastructure.Services;

/// <summary>
/// Soft stub for smart-learning sessions. Persists raw contexts only —
/// inference / Microsoft LM wiring comes later. No graph suggestions yet.
/// </summary>
public sealed class SmartLearningService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private readonly string _root;
    private readonly object _gate = new();

    public SmartLearningService(IOptions<MorobotOptions> options)
    {
        var key = options.Value.EffectiveAppInstanceKey;
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "morobot.soras.ir",
            key,
            "smart-learning");
        Directory.CreateDirectory(_root);
        MigrateLegacySmartRoot(_root);
    }

    private static void MigrateLegacySmartRoot(string newRoot)
    {
        try
        {
            var legacy = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DynamicAutomator",
                "smart-learning");
            if (!Directory.Exists(legacy)) return;
            foreach (var file in Directory.EnumerateFiles(legacy, "*.json"))
            {
                var dest = Path.Combine(newRoot, Path.GetFileName(file));
                if (File.Exists(dest)) continue;
                File.Copy(file, dest, overwrite: false);
            }
        }
        catch
        {
            /* ignore migration failures */
        }
    }

    private string SessionPath(string sessionId) =>
        Path.Combine(_root, $"{Sanitize(sessionId)}.json");

    private static string Sanitize(string id)
    {
        foreach (var c in Path.GetInvalidFileNameChars())
            id = id.Replace(c, '_');
        return id;
    }

    /// <summary>Soft-create a session file. Returns a minimal payload (no AI result).</summary>
    public StartSmartSessionResponse Start(StartSmartSessionRequest request)
    {
        var sessionId = Guid.NewGuid().ToString("N");
        var doc = new SessionDocument
        {
            SessionId = sessionId,
            TaskId = request.TaskId,
            TaskTitle = request.TaskTitle,
            LocalUser = string.IsNullOrWhiteSpace(request.LocalUser) ? "test" : request.LocalUser.Trim(),
            Status = "thinking",
            LearningComplete = false,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            Contexts = new List<JsonElement>()
        };
        Save(doc);
        // Soft empty response — Microsoft LM will populate learning fields later.
        return new StartSmartSessionResponse
        {
            SessionId = sessionId,
            TaskId = doc.TaskId,
            LearningComplete = false,
            Status = "thinking"
        };
    }

    /// <summary>Accept contexts into the session file. Empty soft ack (no inference).</summary>
    public AppendSmartContextsResponse AppendContexts(string sessionId, AppendSmartContextsRequest request)
    {
        lock (_gate)
        {
            var doc = Load(sessionId) ?? throw new KeyNotFoundException("session not found");
            var accepted = 0;
            foreach (var el in request.Contexts ?? new List<JsonElement>())
            {
                doc.Contexts.Add(el);
                accepted++;
            }
            doc.UpdatedAtUtc = DateTimeOffset.UtcNow;
            Save(doc);
            return new AppendSmartContextsResponse
            {
                Ok = true,
                Accepted = accepted,
                TotalContexts = doc.Contexts.Count,
                LearningComplete = false
            };
        }
    }

    /// <summary>Mark session stopped. Soft empty result — learning stays incomplete.</summary>
    public SmartSessionStopResponse Stop(string sessionId)
    {
        lock (_gate)
        {
            var doc = Load(sessionId) ?? throw new KeyNotFoundException("session not found");
            doc.Status = "stopped";
            doc.StoppedAtUtc = DateTimeOffset.UtcNow;
            doc.UpdatedAtUtc = doc.StoppedAtUtc;
            doc.LearningComplete = false;
            doc.SuggestedGraph = null;
            Save(doc);
            return new SmartSessionStopResponse
            {
                Ok = true,
                LearningComplete = false,
                ContextCount = doc.Contexts.Count,
                Status = "stopped"
            };
        }
    }

    public SmartSessionStatusResponse? Get(string sessionId)
    {
        var doc = Load(sessionId);
        if (doc is null) return null;
        return new SmartSessionStatusResponse
        {
            SessionId = doc.SessionId,
            TaskId = doc.TaskId,
            TaskTitle = doc.TaskTitle,
            LocalUser = doc.LocalUser,
            Status = doc.Status,
            LearningComplete = false,
            ContextCount = doc.Contexts.Count,
            CreatedAtUtc = doc.CreatedAtUtc,
            StoppedAtUtc = doc.StoppedAtUtc,
            SuggestedGraph = null
        };
    }

    /// <summary>Soft stub — no graph until Microsoft LM pipeline exists.</summary>
    public SmartSessionSaveResponse SaveResult(string sessionId)
    {
        var doc = Load(sessionId) ?? throw new KeyNotFoundException("session not found");
        return new SmartSessionSaveResponse
        {
            Ok = false,
            Message = null,
            TaskId = doc.TaskId,
            Graph = null
        };
    }

    private SessionDocument? Load(string sessionId)
    {
        var path = SessionPath(sessionId);
        if (!File.Exists(path)) return null;
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<SessionDocument>(json, JsonOpts);
    }

    private void Save(SessionDocument doc)
    {
        var path = SessionPath(doc.SessionId);
        var json = JsonSerializer.Serialize(doc, JsonOpts);
        File.WriteAllText(path, json);
    }

    private sealed class SessionDocument
    {
        public string SessionId { get; set; } = "";
        public long TaskId { get; set; }
        public string? TaskTitle { get; set; }
        public string? LocalUser { get; set; }
        public string Status { get; set; } = "idle";
        public bool LearningComplete { get; set; }
        public DateTimeOffset CreatedAtUtc { get; set; }
        public DateTimeOffset? UpdatedAtUtc { get; set; }
        public DateTimeOffset? StoppedAtUtc { get; set; }
        public List<JsonElement> Contexts { get; set; } = new();
        public object? SuggestedGraph { get; set; }
    }
}
