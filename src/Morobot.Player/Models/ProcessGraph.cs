using System.Text.Json;
using System.Text.Json.Serialization;

namespace Morobot.Player.Models;

/// <summary>
/// A process graph, parsed from the canvas JSON the panel serves.
/// </summary>
/// <remarks>
/// Only the fields the runner actually reads are modelled. The canvas carries a good deal the editor
/// needs and a run does not (positions, colours for authoring, UI state); ignoring them here keeps
/// the port honest about what it is — an executor, not an editor.
/// </remarks>
public sealed class ProcessGraph
{
    [JsonPropertyName("taskId")] public JsonElement TaskIdRaw { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("nodes")] public List<GraphNode> Nodes { get; set; } = new();
    [JsonPropertyName("edges")] public List<GraphEdge> Edges { get; set; } = new();
    [JsonPropertyName("dataSources")] public List<GraphDataSource> DataSources { get; set; } = new();

    /// <summary>Step gap applied between actions, from the process-level start node.</summary>
    public int StepDelayMs { get; set; }

    /// <summary>Loop-back guard, so a bad condition cannot spin forever.</summary>
    public int LoopBackLimit { get; set; } = 100;

    public static ProcessGraph? Parse(string? canvasJson)
    {
        if (string.IsNullOrWhiteSpace(canvasJson)) return null;
        try
        {
            using var doc = JsonDocument.Parse(canvasJson);
            var root = doc.RootElement;
            // The stored canvas is an envelope: { body: "<json string>", ... } for newer records, or
            // the bare object for older ones. Accept both rather than guess by a version field.
            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("body", out var body)
                && body.ValueKind == JsonValueKind.String)
            {
                var inner = body.GetString();
                if (!string.IsNullOrWhiteSpace(inner))
                    return JsonSerializer.Deserialize<ProcessGraph>(inner!);
            }
            return JsonSerializer.Deserialize<ProcessGraph>(canvasJson);
        }
        catch
        {
            return null;
        }
    }

    public GraphNode? StartNode =>
        Nodes.FirstOrDefault(n => string.Equals(n.Kind, "start", StringComparison.OrdinalIgnoreCase) && n.GroupNodeId is null)
        ?? Nodes.FirstOrDefault(n => string.Equals(n.Kind, "start", StringComparison.OrdinalIgnoreCase));

    public GraphNode? NodeById(string? id)
        => id is null ? null : Nodes.FirstOrDefault(n => string.Equals(n.Id, id, StringComparison.Ordinal));

    /// <summary>The node an edge leads to, honouring the success/fail branch a condition takes.</summary>
    public string? NextNodeId(string fromId, bool? conditionPassed)
    {
        var outgoing = Edges.Where(e => string.Equals(e.From, fromId, StringComparison.Ordinal)).ToList();
        if (outgoing.Count == 0) return null;
        if (conditionPassed is null) return outgoing[0].To;
        // A condition's two branches are labelled; fall back to order when unlabelled so an old
        // graph still walks rather than stopping dead.
        var wanted = conditionPassed.Value ? "success" : "fail";
        var match = outgoing.FirstOrDefault(e =>
            string.Equals(e.Label, wanted, StringComparison.OrdinalIgnoreCase)
            || string.Equals(e.Kind, wanted, StringComparison.OrdinalIgnoreCase));
        return (match ?? outgoing[0]).To;
    }
}

public sealed class GraphNode
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("kind")] public string? Kind { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("groupNodeId")] public string? GroupNodeId { get; set; }
    [JsonPropertyName("isActive")] public bool? IsActive { get; set; }

    [JsonPropertyName("actionType")] public string? ActionType { get; set; }
    [JsonPropertyName("selector")] public string? Selector { get; set; }
    [JsonPropertyName("selectorType")] public string? SelectorType { get; set; }
    [JsonPropertyName("selectorIndex")] public int? SelectorIndex { get; set; }
    [JsonPropertyName("selectorWaitEnabled")] public bool? SelectorWaitEnabled { get; set; }
    [JsonPropertyName("selectorWaitMs")] public int? SelectorWaitMs { get; set; }
    [JsonPropertyName("constantValue")] public string? ConstantValue { get; set; }
    [JsonPropertyName("navigateUrl")] public string? NavigateUrl { get; set; }
    [JsonPropertyName("waitMs")] public int? WaitMs { get; set; }
    [JsonPropertyName("highlightColor")] public string? HighlightColor { get; set; }

    // Data source addressing
    [JsonPropertyName("dataSourceId")] public int? DataSourceId { get; set; }
    [JsonPropertyName("saveDataSourceId")] public int? SaveDataSourceId { get; set; }
    [JsonPropertyName("saveColumnName")] public string? SaveColumnName { get; set; }
    [JsonPropertyName("dynamicSourceColumnName")] public string? DynamicSourceColumnName { get; set; }
    [JsonPropertyName("contentSourceType")] public string? ContentSourceType { get; set; }
    [JsonPropertyName("saveTargetType")] public string? SaveTargetType { get; set; }
    [JsonPropertyName("memoryVariableName")] public string? MemoryVariableName { get; set; }
    [JsonPropertyName("rowIndexType")] public string? RowIndexType { get; set; }
    [JsonPropertyName("specificRowIndex")] public int? SpecificRowIndex { get; set; }

    /// <summary>Everything the node carries, for the fields not modelled above.</summary>
    [JsonExtensionData] public Dictionary<string, JsonElement> Extra { get; set; } = new();

    public bool IsAction => string.Equals(Kind, "action", StringComparison.OrdinalIgnoreCase);
    public bool IsCondition => string.Equals(Kind, "condition", StringComparison.OrdinalIgnoreCase);
    public bool IsGroup => string.Equals(Kind, "group", StringComparison.OrdinalIgnoreCase);
    public bool IsEnd => string.Equals(Kind, "end", StringComparison.OrdinalIgnoreCase);
    public bool IsStart => string.Equals(Kind, "start", StringComparison.OrdinalIgnoreCase);

    public string ReadExtraString(string name)
        => Extra.TryGetValue(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    public bool ReadExtraBool(string name)
        => Extra.TryGetValue(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False && v.GetBoolean();
}

public sealed class GraphEdge
{
    [JsonPropertyName("from")] public string From { get; set; } = "";
    [JsonPropertyName("to")] public string To { get; set; } = "";
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("kind")] public string? Kind { get; set; }
}

public sealed class GraphDataSource
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("isPublic")] public bool IsPublic { get; set; }
    [JsonPropertyName("rowCount")] public int RowCount { get; set; }
    [JsonPropertyName("columnKeys")] public List<string> ColumnKeys { get; set; } = new();
}
