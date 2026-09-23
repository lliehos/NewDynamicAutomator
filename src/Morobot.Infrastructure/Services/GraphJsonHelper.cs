using System.Text.Json;

namespace Morobot.Infrastructure.Services;

/// <summary>Helpers for Processes.GraphJson (canvas) documents.</summary>
public static class GraphJsonHelper
{
    public static int CountSources(string? graphJson)
    {
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
}
