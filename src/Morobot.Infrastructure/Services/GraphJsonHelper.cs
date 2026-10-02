using System.Text.Json;
using System.Text.Json.Nodes;

namespace Morobot.Infrastructure.Services;

/// <summary>Helpers for Processes.GraphJson (canvas) documents.</summary>
public static class GraphJsonHelper
{
    /// <summary>
    /// Return the graph from a value that may instead be the store's envelope.
    /// </summary>
    /// <remarks>
    /// Some rows hold <c>{ title, graphJson: "{...}" }</c> rather than the graph itself — the
    /// envelope was written at some point and older rows still carry it. Every reader expects the
    /// graph, and a reader that does not unwrap sees no <c>nodes</c> at the root: the editor then
    /// renders an empty canvas (and would overwrite the real graph on save) and the node counters
    /// report zero. Unwrapping here means each caller does not have to know about the envelope.
    ///
    /// A value that is already a graph is returned unchanged; anything unparseable is passed
    /// through so the existing parse-and-fallback in the callers still applies.
    /// </remarks>
    public static string? UnwrapEnvelope(string? graphJson)
    {
        if (string.IsNullOrWhiteSpace(graphJson)) return graphJson;

        // Cheap reject first: only a value whose root object carries "graphJson" can be an envelope.
        if (!graphJson.Contains("\"graphJson\"", StringComparison.OrdinalIgnoreCase)
            && !graphJson.Contains("\"GraphJson\"", StringComparison.OrdinalIgnoreCase))
            return graphJson;

        try
        {
            using var doc = JsonDocument.Parse(graphJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return graphJson;

            // A root that already has nodes IS the graph, whatever else it carries.
            if (doc.RootElement.TryGetProperty("nodes", out _)
                || doc.RootElement.TryGetProperty("Nodes", out _))
                return graphJson;

            if (!doc.RootElement.TryGetProperty("graphJson", out var inner)
                && !doc.RootElement.TryGetProperty("GraphJson", out inner))
                return graphJson;

            // The inner value is normally a JSON string; tolerate it already being an object.
            if (inner.ValueKind == JsonValueKind.String)
            {
                var text = inner.GetString();
                return string.IsNullOrWhiteSpace(text) ? graphJson : text;
            }
            if (inner.ValueKind == JsonValueKind.Object) return inner.GetRawText();
        }
        catch (JsonException)
        {
            // Not valid JSON: leave it alone so the caller's own handling decides.
        }

        return graphJson;
    }

    /// <summary>
    /// If <paramref name="graphJson"/> is an envelope, return its root object and hand back the
    /// inner graph text; otherwise return <c>null</c> and the input as the body.
    /// </summary>
    /// <remarks>
    /// Distinct from <see cref="UnwrapEnvelope"/>: callers that need to *write back* must keep the
    /// envelope's other fields, so they need the wrapper object itself, not just the inner string.
    /// </remarks>
    public static JsonObject? TryParseEnvelope(string? graphJson, out string bodyJson)
    {
        bodyJson = graphJson ?? string.Empty;
        if (string.IsNullOrWhiteSpace(graphJson)) return null;

        try
        {
            using var doc = JsonDocument.Parse(graphJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;

            // A root that already has nodes IS the graph, not an envelope.
            if (doc.RootElement.TryGetProperty("nodes", out _)
                || doc.RootElement.TryGetProperty("Nodes", out _))
                return null;

            if (!doc.RootElement.TryGetProperty("graphJson", out var inner)
                && !doc.RootElement.TryGetProperty("GraphJson", out inner))
                return null;

            var innerText = inner.ValueKind switch
            {
                JsonValueKind.String => inner.GetString(),
                JsonValueKind.Object => inner.GetRawText(),
                _ => null
            };
            if (string.IsNullOrWhiteSpace(innerText)) return null;

            bodyJson = innerText;
            return JsonNode.Parse(graphJson) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static int CountSources(string? graphJson)
    {
        graphJson = UnwrapEnvelope(graphJson);
        if (string.IsNullOrWhiteSpace(graphJson)) return 0;
        try
        {
            using var doc = JsonDocument.Parse(graphJson);
            if (doc.RootElement.TryGetProperty("dataSources", out var arr) && arr.ValueKind == JsonValueKind.Array)
                return arr.GetArrayLength();
            if (doc.RootElement.TryGetProperty("DataSources", out var arr2) && arr2.ValueKind == JsonValueKind.Array)
                return arr2.GetArrayLength();
        }
        catch { /* ignore */ }
        return 0;
    }

    public static (int groups, int steps) CountNodes(string? graphJson)
    {
        graphJson = UnwrapEnvelope(graphJson);
        if (string.IsNullOrWhiteSpace(graphJson)) return (0, 0);
        try
        {
            using var doc = JsonDocument.Parse(graphJson);
            if (!doc.RootElement.TryGetProperty("nodes", out var nodes)
                && !doc.RootElement.TryGetProperty("Nodes", out nodes))
                return (0, 0);
            if (nodes.ValueKind != JsonValueKind.Array) return (0, 0);
            var groups = 0;
            var steps = 0;
            foreach (var n in nodes.EnumerateArray())
            {
                var kind = n.TryGetProperty("kind", out var k) ? k.GetString()
                    : n.TryGetProperty("Kind", out var k2) ? k2.GetString() : null;
                if (string.Equals(kind, "group", StringComparison.OrdinalIgnoreCase))
                    groups++;
                else if (string.Equals(kind, "step", StringComparison.OrdinalIgnoreCase)
                         || string.Equals(kind, "action", StringComparison.OrdinalIgnoreCase))
                    steps++;
            }
            return (groups, steps);
        }
        catch
        {
            return (0, 0);
        }
    }

    /// <summary>Step + action nodes that count toward MaxProcessSteps.</summary>
    public static int CountProcessSteps(string? graphJson) => CountNodes(graphJson).steps;

    /// <summary>
    /// The start-node fields a child process owns. Everything else comes from its template.
    /// </summary>
    /// <remarks>
    /// A child exists for two reasons only: to point the process at its own data source, and to
    /// run on its own terms (delay, loop cap, repeat mode, highlight colour). Those are exactly
    /// the process-level settings that live on the root start node, so this is the list that
    /// survives a cascade. Everything else — every group, action and condition, and the wiring
    /// between them — is structure, and structure belongs to the template.
    ///
    /// Keep this in step with <c>START_NODE_OWNED_KEYS</c> in the editor's flow.js, which uses the
    /// same list to decide which inspector fields stay enabled on a child.
    /// </remarks>
    public static readonly string[] ChildOwnedStartFields =
    {
        "dataSourceId",
        "highlightColor",
        "repeatSourceType",
        "loopCount",
        "moveLoop",
        "stepDelayMs",
        "loopBackLimit",
        "ignorePlayError",
        "repeatFromIndex",
        "repeatToIndex"
    };

    /// <summary>
    /// Build a child process's graph from its template's graph, keeping the child's own start node.
    /// </summary>
    /// <remarks>
    /// This is the rule the whole mother/template/child feature rests on. The template supplies the
    /// structure; the child supplies its start node. Doing it in one place means the three callers
    /// that need it — publishing a template, pulling a template into one child, and saving the
    /// mother — cannot drift apart and each keep a slightly different idea of what a child owns.
    ///
    /// The child's start node is carried over <b>whole</b>, then only the fields in
    /// <see cref="ChildOwnedStartFields"/> are copied on top of the template's version, so any
    /// field the editor adds to the start node later is preserved by default rather than dropped
    /// because nobody remembered to list it.
    ///
    /// Returns the merged graph text. If either side is unparseable the template's graph is used
    /// as-is: refusing to cascade would leave the child permanently stale, whereas losing a start
    /// node is recoverable (the editor rebuilds one) and is reported by the caller.
    /// </remarks>
    public static string MergeChildGraph(string? templateGraphJson, string? childGraphJson)
    {
        var templateGraph = UnwrapEnvelope(templateGraphJson);
        if (string.IsNullOrWhiteSpace(templateGraph)) return childGraphJson ?? templateGraphJson ?? string.Empty;

        var childGraph = UnwrapEnvelope(childGraphJson);
        if (string.IsNullOrWhiteSpace(childGraph)) return templateGraph;

        try
        {
            var templateRoot = JsonNode.Parse(templateGraph) as JsonObject;
            var childRoot = JsonNode.Parse(childGraph) as JsonObject;
            if (templateRoot is null || childRoot is null) return templateGraph;

            var templateNodes = templateRoot["nodes"] as JsonArray ?? templateRoot["Nodes"] as JsonArray;
            var childNodes = childRoot["nodes"] as JsonArray ?? childRoot["Nodes"] as JsonArray;
            if (templateNodes is null || childNodes is null) return templateGraph;

            var isLower = templateRoot["nodes"] is not null;

            // The child's root start: the only node it is allowed to own.
            var childStart = childNodes
                .OfType<JsonObject>()
                .FirstOrDefault(n => IsKind(n, "start") && !HasGroup(n));

            if (childStart is null) return templateGraph;

            // Find where the template put ITS root start, so the merged graph keeps the same node
            // order and the same positional reads that follow (the editor scrolls to the first node
            // and auto-layout seeds from it).
            var startIndex = -1;
            for (var i = 0; i < templateNodes.Count; i++)
            {
                if (templateNodes[i] is JsonObject t && IsKind(t, "start") && !HasGroup(t))
                {
                    startIndex = i;
                    break;
                }
            }

            // Build the start node: template's shape first, then the child's own values on top.
            var merged = templateNodes[startIndex >= 0 ? startIndex : 0] is JsonObject tplStart
                ? (JsonObject)JsonNode.Parse(tplStart.ToJsonString())!
                : new JsonObject();

            foreach (var field in ChildOwnedStartFields)
            {
                if (childStart[field] is not null) merged[field] = JsonNode.Parse(childStart[field]!.ToJsonString());
            }
            // Never let a child rename the node's identity.
            merged["id"] = childStart["id"]?.DeepClone() ?? merged["id"]?.DeepClone();
            merged["kind"] = "start";

            if (startIndex >= 0)
            {
                templateNodes[startIndex] = merged;
            }
            else
            {
                // The template has no root start (a damaged template): put one in front so the
                // merged graph is still executable rather than silently headless.
                templateNodes.Insert(0, merged);
            }

            if (!isLower && templateRoot["Nodes"] is not null) templateRoot["Nodes"] = templateNodes;

            // Everything else — nodes, edges, viewport, dataSources, and the template's own
            // process-level fields — comes from the template untouched.
            return templateRoot.ToJsonString();
        }
        catch (JsonException)
        {
            return templateGraph;
        }
    }

    private static bool IsKind(JsonObject node, string kind)
    {
        var value = node["kind"]?.GetValue<string>() ?? node["Kind"]?.GetValue<string>();
        return string.Equals(value, kind, StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasGroup(JsonObject node)
    {
        var gid = node["groupNodeId"]?.GetValue<string>() ?? node["GroupNodeId"]?.GetValue<string>();
        return !string.IsNullOrWhiteSpace(gid);
    }

    /// <summary>
    /// Build a NEW child's graph from a template: the template's structure, but a start node that
    /// belongs to the child and is not yet pointed at anything.
    /// </summary>
    /// <remarks>
    /// A child created from a template must not inherit the mother's start-node values. Those are
    /// the process's own run settings — its data source, its repeat range, its delay — and the whole
    /// reason a child exists is to run on a different source. Copying the template's graph verbatim
    /// (which is what <c>CreateProcessAsync</c> used to do) handed every new child the mother's
    /// source and row range, so a child that was never edited silently repeated the mother's rows;
    /// and because the range then matched the mother's, nothing looked wrong until the child was
    /// expected to differ.
    ///
    /// The structure is still the template's, and the repeat <i>mode</i> is kept so the child starts
    /// configured the same way — only the values that must differ between children are cleared.
    /// </remarks>
    public static string NewChildGraphFromTemplate(string? templateGraphJson)
    {
        var templateGraph = UnwrapEnvelope(templateGraphJson);
        if (string.IsNullOrWhiteSpace(templateGraph)) return templateGraphJson ?? string.Empty;

        try
        {
            var root = JsonNode.Parse(templateGraph) as JsonObject;
            if (root is null) return templateGraph;

            var nodes = root["nodes"] as JsonArray ?? root["Nodes"] as JsonArray;
            if (nodes is null) return templateGraph;

            var isLower = root["nodes"] is not null;

            var startIndex = -1;
            for (var i = 0; i < nodes.Count; i++)
            {
                if (nodes[i] is JsonObject n && IsKind(n, "start") && !HasGroup(n))
                {
                    startIndex = i;
                    break;
                }
            }
            if (startIndex < 0) return templateGraph;
            if (nodes[startIndex] is not JsonObject templateStart) return templateGraph;

            var childStart = (JsonObject)JsonNode.Parse(templateStart.ToJsonString())!;
            childStart["dataSourceId"] = null;
            childStart["repeatFromIndex"] = null;
            childStart["repeatToIndex"] = null;

            nodes[startIndex] = childStart;
            if (!isLower && root["Nodes"] is not null) root["Nodes"] = nodes;
            return root.ToJsonString();
        }
        catch (JsonException)
        {
            return templateGraph;
        }
    }
}
