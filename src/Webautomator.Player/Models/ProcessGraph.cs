using System.Text.Json;
using System.Text.Json.Serialization;

namespace Webautomator.Player.Models;

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

    /// <summary>
    /// The process revision this canvas was read at.
    /// </summary>
    /// <remarks>
    /// The canvas endpoint stamps every answer with the process's own last-saved time, which is what
    /// makes "is my cached copy still the server's?" answerable without fetching it again — see
    /// <see cref="Services.CanvasCache"/>.
    /// </remarks>
    [JsonPropertyName("updatedAtUtc")] public DateTime? UpdatedAtUtc { get; set; }

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

    /// <summary>
    /// The TARGET element's selector, as the editor stores it.
    /// </summary>
    /// <remarks>
    /// The canvas field is <c>selectorValue</c> — that is the name the editor writes and the
    /// extension's engine reads (<c>step.selectorValue</c>). This runner used to bind a
    /// <c>selector</c> property instead, which no canvas ever carries, so every selector-bearing
    /// step ran with an EMPTY selector: Firefox answered "Document.querySelector: '' is not a valid
    /// selector" and element conditions silently reported "not met".
    /// </remarks>
    [JsonPropertyName("selectorValue")] public string? SelectorValue { get; set; }

    /// <summary>
    /// The VALUE-side selector (<c>equalSelectorValue</c>): the element a step or condition reads its
    /// value from when the value source is «عنصر صفحه».
    /// </summary>
    [JsonPropertyName("equalSelectorValue")] public string? EqualSelectorValue { get; set; }

    [JsonPropertyName("selectorType")] public string? SelectorType { get; set; }
    [JsonPropertyName("selectorIndex")] public int? SelectorIndex { get; set; }
    [JsonPropertyName("selectorWaitEnabled")] public bool? SelectorWaitEnabled { get; set; }
    [JsonPropertyName("selectorWaitMs")] public int? SelectorWaitMs { get; set; }

    /// <summary>The target selector, falling back to a legacy <c>selector</c> field when present.</summary>
    public string? Selector =>
        ResolvedSelector ?? (!string.IsNullOrWhiteSpace(SelectorValue) ? SelectorValue : ReadExtraString("selector"));

    /// <summary>The value-side selector, falling back to the target selector when the node has none.</summary>
    public string? EqualSelector =>
        ResolvedEqualSelector ?? (!string.IsNullOrWhiteSpace(EqualSelectorValue)
            ? EqualSelectorValue
            : ReadExtraString("equalSelector"));

    /// <summary>
    /// The target selector after this run resolved it (dynamic placeholders, attribute filter).
    /// </summary>
    /// <remarks>
    /// Set before each execution and left over between loops, exactly as engine.js keeps the
    /// resolved selector beside the template: the template must stay untouched so the next row can
    /// resolve it again. <c>null</c> means "not resolved yet".
    /// </remarks>
    public string? ResolvedSelector { get; set; }

    /// <summary>The value-side selector after this run resolved it; see <see cref="ResolvedSelector"/>.</summary>
    public string? ResolvedEqualSelector { get; set; }
    [JsonPropertyName("constantValue")] public string? ConstantValue { get; set; }
    [JsonPropertyName("navigateUrl")] public string? NavigateUrl { get; set; }
    [JsonPropertyName("waitMs")] public int? WaitMs { get; set; }
    [JsonPropertyName("highlightColor")] public string? HighlightColor { get; set; }

    // Data source addressing
    [JsonPropertyName("dataSourceId")] public int? DataSourceId { get; set; }

    /// <summary>
    /// A CONDITION's subject source.
    /// </summary>
    /// <remarks>
    /// A condition keeps two sources: <c>sourceId</c> is the subject it checks, while
    /// <c>dataSourceId</c> is the COMPARE operand's source. Reading only <c>dataSourceId</c> made a
    /// source-subject condition read (and resolve its row pointer against) the wrong source.
    /// </remarks>
    [JsonPropertyName("sourceId")] public int? SourceId { get; set; }

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

    /// <summary>
    /// Read a boolean flag, accepting the shapes a saved canvas actually contains.
    /// </summary>
    /// <remarks>
    /// The editor writes real JSON booleans, but a hand-edited or legacy graph may carry "true" or
    /// 1. Reading only the boolean kind silently turned such a flag OFF — the kind of divergence
    /// that makes a switch look ignored.
    /// </remarks>
    public bool ReadExtraBool(string name, bool fallback)
    {
        if (!Extra.TryGetValue(name, out var v)) return fallback;
        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => v.TryGetInt32(out var n) ? n != 0 : fallback,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) ? b : fallback,
            _ => fallback
        };
    }

    /// <summary>Read an integer field, accepting a numeric string as well.</summary>
    public int? ReadExtraInt(string name)
    {
        if (!Extra.TryGetValue(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n)) return n;
        if (v.ValueKind == JsonValueKind.String
            && int.TryParse(v.GetString(), System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture, out var parsed))
            return parsed;
        return null;
    }
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
