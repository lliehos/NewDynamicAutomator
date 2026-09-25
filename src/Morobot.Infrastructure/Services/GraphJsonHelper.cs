using System.Text.Json;

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
}
