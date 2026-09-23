using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace Morobot.Infrastructure.Services;

/// <summary>
/// One-shot: copy relational Groups/Steps/… into Tasks.CanvasJson before those tables are dropped.
/// Uses ADO.NET so it runs even after EF entities for the graph are removed (before Migrate DROP).
/// </summary>
public static class CanvasBackfillService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public static async Task<(int migrated, int skipped, int alreadyHad)> RunIfNeededAsync(
        string connectionString,
        ILogger? log = null,
        CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);

        if (!await TableExistsAsync(conn, "Groups", ct))
        {
            log?.LogInformation("Canvas backfill skipped: Groups table already gone.");
            return (0, 0, 0);
        }

        // Prefer Tasks.CanvasJson; after rename Processes.GraphJson may already exist.
        var taskTable = await TableExistsAsync(conn, "Tasks", ct) ? "Tasks" : null;
        var canvasCol = "CanvasJson";
        if (taskTable is null && await TableExistsAsync(conn, "Processes", ct))
        {
            taskTable = "Processes";
            canvasCol = await ColumnExistsAsync(conn, "Processes", "GraphJson", ct) ? "GraphJson"
                : await ColumnExistsAsync(conn, "Processes", "CanvasJson", ct) ? "CanvasJson" : null;
        }
        if (taskTable is null || canvasCol is null)
        {
            log?.LogWarning("Canvas backfill: no Tasks/Processes canvas column found.");
            return (0, 0, 0);
        }

        var taskIds = new List<(int Id, string Title, string? Canvas, string? DesignOrigin)>();
        await using (var cmd = new SqlCommand(
                         $"SELECT Id, Title, [{canvasCol}], CAST(DesignOrigin AS nvarchar(40)) FROM [{taskTable}]", conn))
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                taskIds.Add((
                    reader.GetInt32(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.IsDBNull(3) ? "Manual" : reader.GetString(3)
                ));
            }
        }

        var migrated = 0;
        var skipped = 0;
        var alreadyHad = 0;

        foreach (var t in taskIds)
        {
            var hasUsefulCanvas = HasUsefulGraph(t.Canvas);
            var groupCount = await ScalarIntAsync(conn,
                "SELECT COUNT(1) FROM Groups WHERE TaskId = @id", t.Id, ct);

            if (hasUsefulCanvas)
            {
                alreadyHad++;
                // Still merge relational dataSources if canvas has none.
                var merged = await TryMergeRelationalSourcesAsync(conn, taskTable, canvasCol, t.Id, t.Canvas!, ct);
                if (merged) migrated++;
                continue;
            }

            if (groupCount == 0)
            {
                skipped++;
                continue;
            }

            var json = await BuildGraphFromRelationalAsync(conn, t.Id, t.Title, t.DesignOrigin ?? "Manual", t.Canvas, ct);
            await using var upd = new SqlCommand(
                $"UPDATE [{taskTable}] SET [{canvasCol}] = @json, UpdatedAtUtc = SYSUTCDATETIME() WHERE Id = @id", conn);
            upd.Parameters.AddWithValue("@json", json);
            upd.Parameters.AddWithValue("@id", t.Id);
            await upd.ExecuteNonQueryAsync(ct);
            migrated++;
            log?.LogInformation("Backfilled canvas for task {TaskId} from relational graph.", t.Id);
        }

        log?.LogInformation(
            "Canvas backfill done: migrated={Migrated}, alreadyHad={Already}, skippedEmpty={Skipped}",
            migrated, alreadyHad, skipped);
        return (migrated, skipped, alreadyHad);
    }

    private static bool HasUsefulGraph(string? canvas)
    {
        if (string.IsNullOrWhiteSpace(canvas)) return false;
        try
        {
            using var doc = JsonDocument.Parse(canvas);
            if (!doc.RootElement.TryGetProperty("nodes", out var nodes)
                && !doc.RootElement.TryGetProperty("Nodes", out nodes))
                return false;
            return nodes.ValueKind == JsonValueKind.Array && nodes.GetArrayLength() > 0;
        }
        catch
        {
            return false;
        }
    }

    private static async Task<bool> TryMergeRelationalSourcesAsync(
        SqlConnection conn, string taskTable, string canvasCol, int taskId, string canvas, CancellationToken ct)
    {
        if (!await TableExistsAsync(conn, "DataSources", ct) || !await TableExistsAsync(conn, "TaskDataSources", ct))
            return false;

        try
        {
            var root = JsonNode.Parse(canvas)?.AsObject();
            if (root is null) return false;
            var arr = root["dataSources"] as JsonArray ?? root["DataSources"] as JsonArray;
            if (arr is { Count: > 0 }) return false;

            var sources = await LoadDataSourcesAsync(conn, taskId, ct);
            if (sources.Count == 0) return false;
            root["dataSources"] = sources;
            await using var upd = new SqlCommand(
                $"UPDATE [{taskTable}] SET [{canvasCol}] = @json WHERE Id = @id", conn);
            upd.Parameters.AddWithValue("@json", root.ToJsonString(JsonOpts));
            upd.Parameters.AddWithValue("@id", taskId);
            await upd.ExecuteNonQueryAsync(ct);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static async Task<string> BuildGraphFromRelationalAsync(
        SqlConnection conn, int taskId, string title, string designOrigin, string? existingCanvas, CancellationToken ct)
    {
        Dictionary<string, JsonNode?>? pos = null;
        JsonNode? viewport = null;
        if (!string.IsNullOrWhiteSpace(existingCanvas))
        {
            try
            {
                var stored = JsonNode.Parse(existingCanvas)?.AsObject();
                viewport = stored?["viewport"] ?? stored?["Viewport"];
                var nodes = stored?["nodes"] as JsonArray ?? stored?["Nodes"] as JsonArray;
                if (nodes != null)
                {
                    pos = new Dictionary<string, JsonNode?>();
                    foreach (var n in nodes)
                    {
                        var id = n?["id"]?.GetValue<string>() ?? n?["Id"]?.GetValue<string>();
                        if (id != null) pos[id] = n;
                    }
                }
            }
            catch { /* ignore */ }
        }

        var nodesOut = new JsonArray();
        var edgesOut = new JsonArray();

        double StartX(string id, double defX) =>
            pos?.GetValueOrDefault(id)?["x"]?.GetValue<double?>()
            ?? pos?.GetValueOrDefault(id)?["X"]?.GetValue<double?>()
            ?? defX;
        double StartY(string id, double defY) =>
            pos?.GetValueOrDefault(id)?["y"]?.GetValue<double?>()
            ?? pos?.GetValueOrDefault(id)?["Y"]?.GetValue<double?>()
            ?? defY;

        nodesOut.Add(new JsonObject
        {
            ["id"] = "start",
            ["kind"] = "start",
            ["title"] = "شروع",
            ["x"] = StartX("start", 40),
            ["y"] = StartY("start", 220)
        });

        var groups = new List<(int Id, string Title, int Priority, int? ParentId, string SourceType, bool MoveLoop, int? DataSourceId, int? SelectorId)>();
        await using (var cmd = new SqlCommand(
                         @"SELECT Id, Title, Priority, ParentGroupId, SourceType, MoveLoop, DataSourceId, SelectorId
                           FROM Groups WHERE TaskId = @id ORDER BY Priority, Id", conn))
        {
            cmd.Parameters.AddWithValue("@id", taskId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                groups.Add((
                    r.GetInt32(0),
                    r.GetString(1),
                    r.GetInt32(2),
                    r.IsDBNull(3) ? null : r.GetInt32(3),
                    r.IsDBNull(4) ? "None" : Convert.ToString(r.GetValue(4)) ?? "None",
                    !r.IsDBNull(5) && r.GetBoolean(5),
                    r.IsDBNull(6) ? null : r.GetInt32(6),
                    r.IsDBNull(7) ? null : r.GetInt32(7)
                ));
            }
        }

        var gx = 280.0;
        foreach (var g in groups)
        {
            var gid = $"group-{g.Id}";
            var sel = g.SelectorId is int selectorId ? await LoadSelectorAsync(conn, selectorId, ct) : null;
            var gNode = new JsonObject
            {
                ["id"] = gid,
                ["kind"] = "group",
                ["entityId"] = g.Id,
                ["title"] = g.Title,
                ["repeatSourceType"] = MapSourceType(g.SourceType),
                ["moveLoop"] = g.MoveLoop,
                ["dataSourceId"] = g.DataSourceId,
                ["x"] = StartX(gid, gx),
                ["y"] = StartY(gid, 80)
            };
            if (sel != null)
            {
                gNode["selectorValue"] = sel.Value;
                gNode["framePathJson"] = sel.FramePathJson;
            }
            nodesOut.Add(gNode);
            gx += 360;

            var steps = new List<(int Id, string Title, int Priority, int? ActionId, bool IsConditional, bool IsActive)>();
            await using (var cmd = new SqlCommand(
                             @"SELECT Id, Title, Priority, ActionId, IsConditional, IsActive
                               FROM Steps WHERE GroupId = @gid ORDER BY Priority, Id", conn))
            {
                cmd.Parameters.AddWithValue("@gid", g.Id);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct))
                {
                    steps.Add((
                        r.GetInt32(0),
                        r.GetString(1),
                        r.GetInt32(2),
                        r.IsDBNull(3) ? null : r.GetInt32(3),
                        !r.IsDBNull(4) && r.GetBoolean(4),
                        r.IsDBNull(5) || r.GetBoolean(5)
                    ));
                }
            }

            string? prevStepId = null;
            var sy = 0.0;
            foreach (var s in steps)
            {
                var sid = $"step-{s.Id}";
                var action = s.ActionId is int aid ? await LoadActionAsync(conn, aid, ct) : null;
                var node = new JsonObject
                {
                    ["id"] = sid,
                    ["kind"] = "step",
                    ["entityId"] = s.Id,
                    ["title"] = s.Title,
                    ["groupNodeId"] = gid,
                    ["actionType"] = action?.ActionType ?? "NoAction",
                    ["isConditional"] = s.IsConditional,
                    ["isActive"] = s.IsActive,
                    ["constantValue"] = action?.ConstantValue,
                    ["navigateUrl"] = action?.NavigateUrl,
                    ["x"] = StartX(sid, StartX(gid, gx - 360) + 28),
                    ["y"] = StartY(sid, StartY(gid, 80) + 70 + sy)
                };
                if (action?.Selector != null)
                {
                    node["selectorValue"] = action.Selector.Value;
                    node["framePathJson"] = action.Selector.FramePathJson;
                }
                nodesOut.Add(node);
                sy += 110;

                if (prevStepId is null)
                    edgesOut.Add(Edge($"e-g-{g.Id}", gid, sid, "contains"));
                else
                    edgesOut.Add(Edge($"e-n-{prevStepId}-{s.Id}", prevStepId, sid, "next"));
                prevStepId = sid;

                await using (var cgCmd = new SqlCommand(
                                 @"SELECT Id, Title, SuccessGroupId, FailedGroupId, IsActive
                                   FROM ConditionGroups WHERE StepId = @sid", conn))
                {
                    cgCmd.Parameters.AddWithValue("@sid", s.Id);
                    await using var cgr = await cgCmd.ExecuteReaderAsync(ct);
                    while (await cgr.ReadAsync(ct))
                    {
                        if (!cgr.IsDBNull(4) && !cgr.GetBoolean(4)) continue;
                        var cgId = cgr.GetInt32(0);
                        var cid = $"cond-{cgId}";
                        var cTitle = cgr.IsDBNull(1) || string.IsNullOrWhiteSpace(cgr.GetString(1))
                            ? "شرط" : cgr.GetString(1);
                        nodesOut.Add(new JsonObject
                        {
                            ["id"] = cid,
                            ["kind"] = "condition",
                            ["entityId"] = cgId,
                            ["title"] = cTitle,
                            ["groupNodeId"] = gid,
                            ["x"] = StartX(cid, StartX(sid, 0) + 220),
                            ["y"] = StartY(cid, StartY(sid, 0))
                        });
                        edgesOut.Add(Edge($"e-sc-{s.Id}-{cgId}", sid, cid, "next"));
                        if (!cgr.IsDBNull(2))
                            edgesOut.Add(Edge($"e-ok-{cgId}", cid, $"group-{cgr.GetInt32(2)}", "success"));
                        if (!cgr.IsDBNull(3))
                            edgesOut.Add(Edge($"e-fail-{cgId}", cid, $"group-{cgr.GetInt32(3)}", "fail"));
                    }
                }
            }

            if (g.ParentId is int pid)
                edgesOut.Add(Edge($"e-p-{pid}-{g.Id}", $"group-{pid}", gid, "parent"));
        }

        var roots = groups.Where(g => g.ParentId is null).OrderBy(g => g.Priority).ToList();
        if (roots.Count > 0)
            edgesOut.Add(Edge("e-start", "start", $"group-{roots[0].Id}", "next"));

        var dataSources = await LoadDataSourcesAsync(conn, taskId, ct);

        var root = new JsonObject
        {
            ["taskId"] = taskId,
            ["title"] = title,
            ["designOrigin"] = designOrigin,
            ["viewport"] = viewport ?? new JsonObject { ["x"] = 80, ["y"] = 40, ["zoom"] = 1 },
            ["nodes"] = nodesOut,
            ["edges"] = edgesOut,
            ["dataSources"] = dataSources
        };
        return root.ToJsonString(JsonOpts);
    }

    private static JsonObject Edge(string id, string from, string to, string kind) => new()
    {
        ["id"] = id,
        ["from"] = from,
        ["to"] = to,
        ["kind"] = kind
    };

    private static string MapSourceType(string raw)
    {
        // May be int enum or name
        if (int.TryParse(raw, out var n))
            return n switch { 1 => "DataSource", 2 => "Elements", 3 => "Loops", _ => "None" };
        return string.IsNullOrWhiteSpace(raw) ? "None" : raw;
    }

    private record Sel(string Value, string FramePathJson);
    private record Act(string ActionType, string? ConstantValue, string? NavigateUrl, Sel? Selector);

    private static async Task<Sel?> LoadSelectorAsync(SqlConnection conn, int id, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(
            "SELECT ElementValue, FramePathJson FROM Selectors WHERE Id = @id", conn);
        cmd.Parameters.AddWithValue("@id", id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        return new Sel(r.GetString(0), r.IsDBNull(1) ? "[]" : r.GetString(1));
    }

    private static async Task<Act?> LoadActionAsync(SqlConnection conn, int id, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(
            @"SELECT ActionType, ConstantValue, NavigateUrl, SelectorId FROM Actions WHERE Id = @id", conn);
        cmd.Parameters.AddWithValue("@id", id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        var actionType = Convert.ToString(r.GetValue(0)) ?? "NoAction";
        if (int.TryParse(actionType, out var at))
            actionType = ((Domain.Enums.ActionType)at).ToString();
        Sel? sel = null;
        if (!r.IsDBNull(3))
        {
            var sid = r.GetInt32(3);
            await r.CloseAsync();
            sel = await LoadSelectorAsync(conn, sid, ct);
        }
        else
        {
            await r.CloseAsync();
        }
        // Re-read constants — already captured before close
        await using var cmd2 = new SqlCommand(
            @"SELECT ConstantValue, NavigateUrl FROM Actions WHERE Id = @id", conn);
        cmd2.Parameters.AddWithValue("@id", id);
        await using var r2 = await cmd2.ExecuteReaderAsync(ct);
        string? cv = null, nu = null;
        if (await r2.ReadAsync(ct))
        {
            cv = r2.IsDBNull(0) ? null : r2.GetString(0);
            nu = r2.IsDBNull(1) ? null : r2.GetString(1);
        }
        return new Act(actionType, cv, nu, sel);
    }

    private static async Task<JsonArray> LoadDataSourcesAsync(SqlConnection conn, int taskId, CancellationToken ct)
    {
        var arr = new JsonArray();
        if (!await TableExistsAsync(conn, "TaskDataSources", ct)) return arr;

        var ids = new List<int>();
        await using (var cmd = new SqlCommand(
                         "SELECT DataSourcesId FROM TaskDataSources WHERE TasksId = @id", conn))
        {
            cmd.Parameters.AddWithValue("@id", taskId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                ids.Add(r.GetInt32(0));
        }

        foreach (var dsId in ids)
        {
            string title;
            string columnsJson;
            await using (var cmd = new SqlCommand("SELECT Title, ColumnsJson FROM DataSources WHERE Id = @id", conn))
            {
                cmd.Parameters.AddWithValue("@id", dsId);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                if (!await r.ReadAsync(ct)) continue;
                title = r.GetString(0);
                columnsJson = r.IsDBNull(1) ? "[]" : r.GetString(1);
            }

            var cells = new JsonArray();
            var maxRow = -1;
            await using (var cmd = new SqlCommand(
                             "SELECT RowIndex, ColumnName, CellValue FROM DataSourceCells WHERE DataSourceId = @id", conn))
            {
                cmd.Parameters.AddWithValue("@id", dsId);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct))
                {
                    var row = r.GetInt32(0);
                    if (row > maxRow) maxRow = row;
                    cells.Add(new JsonObject
                    {
                        ["key"] = r.GetString(1),
                        ["index"] = row,
                        ["cellValue"] = r.IsDBNull(2) ? "" : r.GetString(2)
                    });
                }
            }

            JsonNode? columns;
            try { columns = JsonNode.Parse(columnsJson); }
            catch { columns = new JsonArray(); }

            var colCount = columns is JsonArray ca ? ca.Count : 0;
            arr.Add(new JsonObject
            {
                ["id"] = dsId,
                ["title"] = title,
                ["columnCount"] = colCount,
                ["rowCount"] = maxRow + 1,
                ["columns"] = columns,
                ["cells"] = cells
            });
        }

        return arr;
    }

    /// <summary>Build Graph JSON for one task from a legacy relational DB (mid-schema or Windows V2-style).</summary>
    public static async Task<string?> ExportTaskGraphJsonAsync(
        string connectionString, int taskId, CancellationToken ct = default)
    {
        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);
        return await ExportTaskGraphJsonAsync(conn, taskId, ct);
    }

    public static async Task<string?> ExportTaskGraphJsonAsync(
        SqlConnection conn, int taskId, CancellationToken ct = default)
    {
        string? title = null;
        string? canvas = null;
        string designOrigin = "Manual";

        if (await TableExistsAsync(conn, "Tasks", ct))
        {
            var hasCanvas = await ColumnExistsAsync(conn, "Tasks", "CanvasJson", ct);
            var hasOrigin = await ColumnExistsAsync(conn, "Tasks", "DesignOrigin", ct);
            var sql = hasCanvas
                ? (hasOrigin
                    ? "SELECT Title, CanvasJson, CAST(DesignOrigin AS nvarchar(40)) FROM Tasks WHERE Id=@id"
                    : "SELECT Title, CanvasJson, NULL FROM Tasks WHERE Id=@id")
                : "SELECT Title, NULL, NULL FROM Tasks WHERE Id=@id";
            await using var cmd = new SqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@id", taskId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return null;
            title = r.GetString(0);
            canvas = r.IsDBNull(1) ? null : r.GetString(1);
            if (!r.IsDBNull(2)) designOrigin = r.GetString(2) ?? "Manual";
        }
        else
            return null;

        if (HasUsefulGraph(canvas))
            return canvas;

        if (!await TableExistsAsync(conn, "Groups", ct))
        {
            // Minimal empty process
            return new JsonObject
            {
                ["taskId"] = taskId,
                ["title"] = title ?? "",
                ["designOrigin"] = designOrigin,
                ["viewport"] = new JsonObject { ["x"] = 80, ["y"] = 40, ["zoom"] = 1 },
                ["nodes"] = new JsonArray
                {
                    new JsonObject { ["id"] = "start", ["kind"] = "start", ["title"] = "شروع", ["x"] = 40, ["y"] = 220 }
                },
                ["edges"] = new JsonArray(),
                ["dataSources"] = new JsonArray()
            }.ToJsonString(JsonOpts);
        }

        return await BuildGraphFromRelationalAsync(conn, taskId, title ?? "", designOrigin, canvas, ct);
    }

    public static Task<bool> LegacyTableExistsAsync(SqlConnection conn, string name, CancellationToken ct)
        => TableExistsAsync(conn, name, ct);

    private static async Task<bool> TableExistsAsync(SqlConnection conn, string name, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(
            "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @n", conn);
        cmd.Parameters.AddWithValue("@n", name);
        return await cmd.ExecuteScalarAsync(ct) is not null;
    }

    private static async Task<bool> ColumnExistsAsync(SqlConnection conn, string table, string col, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(
            "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t AND COLUMN_NAME = @c", conn);
        cmd.Parameters.AddWithValue("@t", table);
        cmd.Parameters.AddWithValue("@c", col);
        return await cmd.ExecuteScalarAsync(ct) is not null;
    }

    private static async Task<int> ScalarIntAsync(SqlConnection conn, string sql, int id, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);
        var o = await cmd.ExecuteScalarAsync(ct);
        return o is int i ? i : Convert.ToInt32(o);
    }
}
