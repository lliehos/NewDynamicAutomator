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

        var startNode = new JsonObject
        {
            ["id"] = "start",
            ["kind"] = "start",
            ["title"] = "شروع",
            ["x"] = StartX("start", 40),
            ["y"] = StartY("start", 220)
        };
        nodesOut.Add(startNode);

        // The Windows-era schema misspelled both columns (ParrentGroupId / MooveLoop).
        var hasParrent = await ColumnExistsAsync(conn, "Groups", "ParrentGroupId", ct);
        var hasParent = await ColumnExistsAsync(conn, "Groups", "ParentGroupId", ct);
        var hasMoove = await ColumnExistsAsync(conn, "Groups", "MooveLoop", ct);
        var hasMove = await ColumnExistsAsync(conn, "Groups", "MoveLoop", ct);

        var groups = new List<(int Id, string Title, int Priority, int? ParentId, string SourceType, bool MoveLoop, int? DataSourceId, int? SelectorId)>();
        await using (var cmd = new SqlCommand(
                         "SELECT Id, Title, Priority"
                         + (hasParrent ? ", ParrentGroupId" : hasParent ? ", ParentGroupId" : ", CAST(NULL AS int) AS ParrentGroupId")
                         + ", SourceType"
                         + (hasMoove ? ", MooveLoop" : hasMove ? ", MoveLoop" : ", CAST(0 AS bit) AS MooveLoop")
                         + ", DataSourceId, SelectorId"
                         + " FROM Groups WHERE TaskId = @id ORDER BY Priority, Id", conn))
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

        // Legacy group chain: a group's NEXT groups are the groups whose ParrentGroupId points at it
        // (the old engine's Group.GetNextGroups did exactly this — the column holds the PREVIOUS
        // group, so children are the groups that run after it). Tasks also carry First/LastGroupId
        // columns but they are NULL across the Windows-era databases, so the entry is the first
        // parent-less group, mirroring the old FormMain `FirstOrDefault(ParrentGroupId == null)`.
        int? firstGroupId = null;
        int? lastGroupId = null;
        if (await ColumnExistsAsync(conn, "Tasks", "FirstGroupId", ct))
        {
            await using var tcmd = new SqlCommand("SELECT FirstGroupId, LastGroupId FROM Tasks WHERE Id = @id", conn);
            tcmd.Parameters.AddWithValue("@id", taskId);
            await using var tr = await tcmd.ExecuteReaderAsync(ct);
            if (await tr.ReadAsync(ct))
            {
                firstGroupId = tr.IsDBNull(0) ? null : tr.GetInt32(0);
                lastGroupId = tr.IsDBNull(1) ? null : tr.GetInt32(1);
            }
        }

        var groupById = groups.ToDictionary(x => x.Id);
        var childGroups = new Dictionary<int, List<(int Id, int Priority)>>();
        foreach (var g in groups)
        {
            if (g.ParentId is int parentOf && groupById.ContainsKey(parentOf))
            {
                if (!childGroups.TryGetValue(parentOf, out var kids))
                {
                    kids = new List<(int, int)>();
                    childGroups[parentOf] = kids;
                }
                kids.Add((g.Id, g.Priority));
            }
        }
        foreach (var key in childGroups.Keys.ToList())
        {
            childGroups[key] = childGroups[key].OrderBy(x => x.Priority).ThenBy(x => x.Id).ToList();
        }

        // A guard that fails at the end of its chain falls through to the group's next groups
        // (the legacy first branch executed them); a router branch with no target group simply
        // stopped — there the new graph ends.
        string GroupExitTarget(int groupId)
            => childGroups.TryGetValue(groupId, out var kids) && kids.Count > 0 ? $"group-{kids[0].Id}" : "end";

        var groupNodes = new Dictionary<int, JsonObject>();

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
                ApplySelector(gNode, sel);
            }
            nodesOut.Add(gNode);
            groupNodes[g.Id] = gNode;
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

            // ---- legacy execution semantics (Windows engine: StepExtensions / GroupExtentions) ----
            //  * steps run in Priority order; INACTIVE steps never ran — they are not converted;
            //  * a CONDITIONAL step's condition groups are a GUARD: the action runs only when every
            //    active group passes, otherwise the walk skips to the next step;
            //  * a NO-ACTION step with condition groups is a pure ROUTER (the old app had no
            //    standalone condition node): passed → SuccessGroupId, failed → FaildGroupId;
            //  * any other step with condition groups runs its action first, then routes.
            var sy = 0.0;
            var chainEntry = (string?)null;    // first node of the group's chain
            var chainTail = (string?)null;     // node whose `next` continues the chain
            var chainBroken = false;           // a router/route step already took over the flow
            var pendingGuardFails = new List<string>();                        // guards awaiting the skip target
            var pendingBranches = new List<(string CondId, string Branch)>();  // branches with no explicit target
            var skippedInactive = new List<string>();
            var groupNotes = new List<string>();

            double CondX(string sid) => StartX(sid, StartX(gid, gx - 360) + 28) + 220;
            double CondY(string sid) => StartY(sid, StartY(gid, 80) + 70 + sy);

            JsonObject CreateConditionNode(LegacyConditionGroupRow cg, string sid)
            {
                var cid = $"cond-{cg.Id}";
                var plan = LegacySelectorNormalizer.MapConditionGroup(cg.Conditions);
                // The current app has no condition-group entity: AND is a run of consecutive
                // conditions, OR is parallel branches. The group node carries the whole plan so
                // one legacy group can be replayed without changing its meaning.
                var condNode = new JsonObject
                {
                    ["id"] = cid,
                    ["kind"] = "condition",
                    ["entityId"] = cg.Id,
                    ["title"] = string.IsNullOrWhiteSpace(cg.Title) ? "شرط" : cg.Title,
                    ["groupNodeId"] = gid,
                    ["x"] = StartX(cid, CondX(sid)),
                    ["y"] = StartY(cid, CondY(sid))
                };

                ApplyConditionPlan(condNode, plan);

                // The legacy break-loop flags have no current equivalent; they are kept visible
                // so the operator can rebuild the loop once the process is here.
                if (cg.BreakOnFaild) condNode["legacyBreakOnFaild"] = true;
                if (cg.BreakOnSuccess) condNode["legacyBreakOnSuccess"] = true;
                if (cg.BreakOnFaild || cg.BreakOnSuccess)
                    AppendNodeNote(condNode,
                        "نتیجهٔ شرط در نسخهٔ قدیم می‌توانست حلقه را بشکند؛ به‌عنوان یادداشت نگه داشته شد.");

                nodesOut.Add(condNode);
                return condNode;
            }

            void WireBranch(LegacyConditionGroupRow cg, string condId, bool success)
            {
                var explicitId = success ? cg.SuccessGroupId : cg.FailedGroupId;
                if (explicitId is int eid && groupById.ContainsKey(eid))
                {
                    edgesOut.Add(Edge($"e-{(success ? "ok" : "fail")}-{cg.Id}", condId,
                        $"group-{eid}", success ? "success" : "fail"));
                }
                else
                {
                    // No target group: the walk continues where the step would have continued.
                    pendingBranches.Add((condId, success ? "success" : "fail"));
                }
            }

            void AttachEntry(string entryId)
            {
                if (chainEntry is null && !chainBroken)
                {
                    chainEntry = entryId;
                }
                else if (chainTail is not null)
                {
                    edgesOut.Add(Edge($"e-n-{chainTail}-{entryId}", chainTail, entryId, "next"));
                }
                else if (chainBroken)
                {
                    const string brokenNote =
                        "بعد از یک مرحلهٔ شرطی، مرحله‌های بعدی همین گروه در نسخهٔ قدیم هم‌زمان با مسیر شرط اجرا می‌شدند؛ در گراف جدید فقط از مسیر شرط قابل دسترسی‌اند.";
                    if (!groupNotes.Contains(brokenNote)) groupNotes.Add(brokenNote);
                }

                // Whatever was waiting for "what comes after the guarded/routed step" now knows.
                foreach (var guardId in pendingGuardFails)
                    edgesOut.Add(Edge($"e-skp-{guardId}", guardId, entryId, "fail"));
                pendingGuardFails.Clear();
                foreach (var (pendingCond, branch) in pendingBranches)
                    edgesOut.Add(Edge($"e-{branch}-{pendingCond}", pendingCond, entryId, branch));
                pendingBranches.Clear();
            }

            foreach (var s in steps)
            {
                var sid = $"step-{s.Id}";
                if (!s.IsActive)
                {
                    // The old engine only ever walked active steps (GetFirstStep/GetNextStep).
                    skippedInactive.Add(s.Title);
                    continue;
                }

                var action = s.ActionId is int aid ? await LoadActionAsync(conn, aid, ct) : null;
                var isNoAction = action is null || string.Equals(action.Kind, "NoAction", StringComparison.Ordinal);
                var cgs = await LoadConditionGroupsForStepAsync(conn, s.Id, ct);
                // A conditional no-action step is a plain pass-through in the old engine: its
                // condition groups were never evaluated (nothing to guard).
                var cgSuppressed = s.IsConditional && isNoAction && cgs.Count > 0;
                if (cgSuppressed) cgs.Clear();
                var hadCg = cgs.Count > 0;

                var node = new JsonObject
                {
                    ["id"] = sid,
                    ["kind"] = "step",
                    ["entityId"] = s.Id,
                    ["title"] = s.Title,
                    ["groupNodeId"] = gid,
                    ["actionType"] = action?.Kind ?? "NoAction",
                    ["isConditional"] = s.IsConditional,
                    ["isActive"] = s.IsActive,
                    ["constantValue"] = action?.ConstantValue,
                    ["navigateUrl"] = action?.NavigateUrl,
                    ["x"] = StartX(sid, StartX(gid, gx - 360) + 28),
                    ["y"] = StartY(sid, StartY(gid, 80) + 70 + sy)
                };
                if (action != null)
                {
                    if (!string.IsNullOrWhiteSpace(action.LegacyActionType))
                        node["legacyActionType"] = action.LegacyActionType;

                    if (!string.IsNullOrWhiteSpace(action.ContentSourceType)
                        && !action.ContentSourceType.Equals("none", StringComparison.OrdinalIgnoreCase))
                        node["contentSourceType"] = action.ContentSourceType;
                    if (!string.IsNullOrWhiteSpace(action.DynamicColumn))
                        node["dynamicSourceColumnName"] = action.DynamicColumn;

                    if (action.SaveSourceId is int srid && srid > 0)
                    {
                        node["saveDataSourceId"] = srid;
                        node["saveColumnName"] = action.DynamicColumn;
                        // When the value comes FROM the source, the same binding is its reader.
                        if (string.Equals(action.ContentSourceType, "DataSource", StringComparison.OrdinalIgnoreCase))
                            node["dataSourceId"] = srid;
                    }

                    var pointer = MapRowPointer(action.RowIndexType);
                    if (pointer is not null)
                    {
                        node["dedicatedRow"] = true;
                        node["rowIndexType"] = pointer;
                    }

                    if (!string.IsNullOrWhiteSpace(action.CloseTabTarget))
                        node["closeTabTarget"] = action.CloseTabTarget;

                    if (action.WaitMs is int wms && wms > 0
                        && string.Equals(action.Kind, "WaitTime", StringComparison.Ordinal))
                    {
                        node["constantValue"] = wms.ToString();
                        node["contentSourceType"] = "Constant";
                    }

                    if (action.Notes.Count > 0)
                        node["conversionNotes"] = new JsonArray(action.Notes.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray());
                }
                if (action?.Selector != null)
                {
                    ApplySelector(node, action.Selector);
                }
                if (isNoAction && !s.IsConditional && hadCg)
                {
                    // A no-action step with condition groups is a ROUTER: the old app had no
                    // standalone condition node, so routing lived on an empty step. Here the
                    // condition node takes that step's place; the step node itself is dropped.
                    var first = true;
                    foreach (var cg in cgs)
                    {
                        var cond = CreateConditionNode(cg, sid);
                        if (first)
                        {
                            AttachEntry(cond["id"]!.GetValue<string>());
                            first = false;
                        }
                        else
                        {
                            AppendNodeNote(cond,
                                "در نسخهٔ قدیم این شرط هم‌زمان با شرط اول بررسی می‌شد؛ اینجا به‌عنوان شاخهٔ اضافی رسم شده است.");
                        }
                        WireBranch(cg, cond["id"]!.GetValue<string>(), true);
                        WireBranch(cg, cond["id"]!.GetValue<string>(), false);
                    }
                    chainBroken = true;
                    chainTail = null;
                }
                else
                {
                    if (cgSuppressed)
                        AppendNodeNote(node,
                            "شرط‌های این مرحله در نسخهٔ قدیم بررسی نمی‌شدند (مرحله بدون اقدام بود)؛ شرط‌ها منتقل نشدند.");
                    nodesOut.Add(node);

                    if (s.IsConditional && hadCg)
                    {
                        // Conditional step = GUARD: the action runs only when EVERY active group
                        // passes; any failure skips the action and continues with the next step.
                        var guardIds = new List<string>();
                        foreach (var cg in cgs)
                            guardIds.Add(CreateConditionNode(cg, sid)["id"]!.GetValue<string>());
                        for (var i = 0; i + 1 < guardIds.Count; i++)
                            edgesOut.Add(Edge($"e-gs-{guardIds[i]}", guardIds[i], guardIds[i + 1], "success"));
                        edgesOut.Add(Edge($"e-gs-{s.Id}", guardIds[^1], sid, "success"));
                        AttachEntry(guardIds[0]);
                        pendingGuardFails.AddRange(guardIds);
                        chainTail = sid;
                    }
                    else if (!isNoAction && hadCg)
                    {
                        // The action runs first; its condition groups then route to the target groups.
                        var first = true;
                        foreach (var cg in cgs)
                        {
                            var cond = CreateConditionNode(cg, sid);
                            if (first)
                            {
                                edgesOut.Add(Edge($"e-sc-{s.Id}-{cg.Id}", sid, cond["id"]!.GetValue<string>(), "next"));
                                first = false;
                            }
                            else
                            {
                                AppendNodeNote(cond,
                                    "در نسخهٔ قدیم این شرط هم‌زمان با شرط اول بررسی می‌شد؛ اینجا به‌عنوان شاخهٔ اضافی رسم شده است.");
                            }
                            WireBranch(cg, cond["id"]!.GetValue<string>(), true);
                            WireBranch(cg, cond["id"]!.GetValue<string>(), false);
                        }
                        chainBroken = true;
                        chainTail = null;
                    }
                    else
                    {
                        AttachEntry(sid);
                        chainTail = sid;
                    }
                }
                sy += 110;
            }

            // Chain end: guard failures fall through to the group's next groups; a router branch
            // with no target stopped the legacy walk, so it ends at the terminal marker here.
            var groupExit = GroupExitTarget(g.Id);
            foreach (var guardId in pendingGuardFails)
                edgesOut.Add(Edge($"e-skp-{guardId}", guardId, groupExit, "fail"));
            pendingGuardFails.Clear();
            foreach (var (pendingCond, branch) in pendingBranches)
                edgesOut.Add(Edge($"e-{branch}-{pendingCond}", pendingCond, "end", branch));
            pendingBranches.Clear();

            if (chainEntry is not null)
                edgesOut.Add(Edge($"e-g-{g.Id}", gid, chainEntry, "contains"));

            if (skippedInactive.Count > 0)
                groupNotes.Add("مراحل غیرفعال که در نسخهٔ قدیم اجرا نمی‌شدند و منتقل نشدند: " + string.Join("، ", skippedInactive));
            if (groupNotes.Count > 0)
                groupNodes[g.Id]["conversionNotes"] = new JsonArray(groupNotes.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray());
        }

        // Group → next group(s): the legacy chain lives on Groups.ParrentGroupId (children are the
        // groups that run after this one). The player follows a group's FIRST `next` edge when its
        // inner walk finishes, so every group gets one — leaf groups hand over to the end marker.
        foreach (var g in groups)
        {
            if (!childGroups.TryGetValue(g.Id, out var kids) || kids.Count == 0)
            {
                edgesOut.Add(Edge($"e-gn-{g.Id}", $"group-{g.Id}", "end", "next"));
                continue;
            }

            foreach (var (kidId, _) in kids)
                edgesOut.Add(Edge($"e-gn-{g.Id}-{kidId}", $"group-{g.Id}", $"group-{kidId}", "next"));

            if (kids.Count > 1)
                AppendNodeNote(groupNodes[g.Id],
                    "این گروه در نسخهٔ قدیم چند گروه بعدی داشت و همه اجرا می‌شدند؛ در گراف جدید فقط اولین ادامه اجرا می‌شود — بقیه به‌عنوان شاخه رسم شده‌اند.");
        }

        // Entry group mirrors the old FormMain: `Groups.FirstOrDefault(ParrentGroupId == null)` —
        // FirstGroupId is carried when present (it is NULL across the Windows-era databases).
        var entryGroupId = firstGroupId is int fg2 && groupById.ContainsKey(fg2)
            ? fg2
            : groups.Where(x => x.ParentId is null).OrderBy(x => x.Id).Select(x => (int?)x.Id).FirstOrDefault()
              ?? groups.OrderBy(x => x.Id).Select(x => (int?)x.Id).FirstOrDefault();
        if (entryGroupId is int entryId)
        {
            edgesOut.Add(Edge("e-start", "start", $"group-{entryId}", "next"));

            // The legacy process carried NO repeat of its own: the repeat configuration of the
            // FIRST executed group drove the whole run (owner, 2026-10-02). Move that config onto
            // the process start, and keep the entry group at "once" so rows are not looped twice.
            if (groupById.TryGetValue(entryId, out var entry))
            {
                switch (MapSourceType(entry.SourceType))
                {
                    case "DataSource":
                        startNode["repeatSourceType"] = "DataSource";
                        if (entry.DataSourceId is int entryDs) startNode["dataSourceId"] = entryDs;
                        AppendNodeNote(startNode,
                            "در نسخهٔ قدیم نوع تکرار فرآیند از اولین گروه اجرایی «" + entry.Title
                            + "» خوانده می‌شد: «سطرهای منبع داده»"
                            + (entry.DataSourceId is int ? "" : " (شناسهٔ منبع روی همان گروه ثبت نشده بود)")
                            + ". همان منبع منتقل و به فرآیند متصل می‌شود.");
                        groupNodes[entryId]["repeatSourceType"] = "None";
                        break;
                    case "Loops":
                        startNode["repeatSourceType"] = "Loops";
                        startNode["loopCount"] = 1;
                        AppendNodeNote(startNode,
                            "در نسخهٔ قدیم نوع تکرار فرآیند از اولین گروه اجرایی «" + entry.Title
                            + "» از نوع «حلقه» بود و تعدادش هنگام اجرا (اندیس صفرمبنا) پرسیده می‌شد؛ اینجا ۱ گذاشته شد.");
                        groupNodes[entryId]["repeatSourceType"] = "None";
                        break;
                    case "Elements":
                        // Process-level page-element repetition is invalid in the current engine
                        // («تکرار با المان صفحه فقط داخل گروه مجاز است») — keep it on the group.
                        AppendNodeNote(groupNodes[entryId],
                            "در نسخهٔ قدیم نوع تکرار فرآیند روی این گروه (اولین گروه) «المان‌های صفحه» بود؛ موتور جدید این نوع را فقط داخل گروه می‌پذیرد، پس همین‌جا نگه داشته شد.");
                        break;
                }
            }
        }

        // Terminal marker: the player treats it as a clean stop and lets unwired router branches
        // end there instead of failing the run.
        nodesOut.Add(new JsonObject
        {
            ["id"] = "end",
            ["kind"] = "end",
            ["title"] = "پایان",
            ["x"] = StartX("end", gx + 80),
            ["y"] = StartY("end", 220)
        });

        // Root groups the legacy chain never reached (they were started from the group list by
        // hand) stay visible but get an explanatory note.
        var flowTargets = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in edgesOut)
        {
            var branchKind = e?["kind"]?.GetValue<string>();
            if (branchKind is "next" or "success" or "fail")
            {
                var toNode = e?["to"]?.GetValue<string>();
                if (toNode is not null) flowTargets.Add(toNode);
            }
        }
        foreach (var g in groups)
        {
            if (entryGroupId is int egCheck && g.Id == egCheck) continue;
            if (g.ParentId is int parent2 && groupById.ContainsKey(parent2)) continue;
            if (flowTargets.Contains($"group-{g.Id}")) continue;
            AppendNodeNote(groupNodes[g.Id],
                "این گروه در نسخهٔ قدیم از طریق فهرست گروه‌ها به‌صورت دستی اجرا می‌شد و در زنجیرهٔ خودکار ورودی ندارد.");
        }

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

    /// <summary>Append one conversion note, keeping any notes already on the node.</summary>
    private static void AppendNodeNote(JsonObject node, string note)
    {
        if (node["conversionNotes"] is JsonArray existing)
        {
            existing.Add((JsonNode?)JsonValue.Create(note));
            return;
        }
        node["conversionNotes"] = new JsonArray((JsonNode?)JsonValue.Create(note));
    }

    private static string MapSourceType(string raw)
    {
        // May be int enum or a name; the Windows-era schema stored "none" in lower case.
        if (int.TryParse(raw, out var n))
            return n switch { 1 => "DataSource", 2 => "Elements", 3 => "Loops", _ => "None" };
        var s = (raw ?? string.Empty).Trim();
        if (s.Length == 0) return "None";
        return s.ToLowerInvariant() switch
        {
            "none" => "None",
            "datasource" => "DataSource",
            "elements" => "Elements",
            "loops" => "Loops",
            _ => s
        };
    }

    private record Sel(string Value, string FramePathJson)
    {
        /// <summary>
        /// The legacy value converted to a typed selector. A legacy ElementValue is a raw string
        /// (CSS, full XPath, or a bare id) and is NOT directly usable, so every reader must go
        /// through this rather than using <see cref="Value"/> on its own.
        /// </summary>
        public LegacySelectorNormalizer.NormalizedSelector Normalized { get; init; } =
            LegacySelectorNormalizer.Normalize(string.Empty);
        /// <summary>The legacy `IsDynamci` flag — the selector value came from a source row.</summary>
        public bool IsDynamic { get; init; }
        /// <summary>Column the dynamic selector value is read from.</summary>
        public string? DynamicColumn { get; init; }
        /// <summary>Source the dynamic selector value is read from.</summary>
        public int? DynamicSourceId { get; init; }
        /// <summary>Notes produced while loading the row (frame chains, dynamics, …).</summary>
        public List<string> ExtraNotes { get; } = new();
    }

    /// <summary>One legacy action row, mapped toward the current step model.</summary>
    private sealed class Act
    {
        /// <summary>Current-app action kind (an ActionType enum member name).</summary>
        public string Kind { get; init; } = "NoAction";
        /// <summary>The raw legacy ActionType text when it differs from <see cref="Kind"/>.</summary>
        public string? LegacyActionType { get; init; }
        public string? ConstantValue { get; init; }
        public string? NavigateUrl { get; init; }
        public Sel? Selector { get; init; }
        /// <summary>Legacy ContentSourceType (Constant/DataSource/Memory/Elements/none).</summary>
        public string? ContentSourceType { get; init; }
        /// <summary>Legacy DynamicSourceColumnName — the source column the action reads/writes.</summary>
        public string? DynamicColumn { get; init; }
        /// <summary>Legacy SaveSourceId — the source the action reads from or writes into.</summary>
        public int? SaveSourceId { get; init; }
        /// <summary>Legacy RowIndexType raw value (mapped separately).</summary>
        public string? RowIndexType { get; init; }
        /// <summary>Legacy WaitTimeDuration (ms) for WaitTime actions.</summary>
        public int? WaitMs { get; init; }
        /// <summary>Set when the action closed a specific tab ("First"/"Last").</summary>
        public string? CloseTabTarget { get; init; }
        /// <summary>Conversion notes surfaced to the operator (also copied onto the node).</summary>
        public List<string> Notes { get; } = new();
    }

    /// <summary>
    /// Stamp a node with the typed selector fields the current editor/runner expect, next to the
    /// legacy text kept for auditing.
    /// </summary>
    private static void ApplySelector(JsonObject node, Sel selector)
    {
        var n = selector.Normalized;
        // The new engine is CSS-only (document.querySelectorAll); the legacy kind is never emitted.
        node["selectorValue"] = n.Value;
        if (n.Managed)
            node["selectorNeedsReview"] = true;
        if (!string.IsNullOrWhiteSpace(n.LegacyValue) && !string.Equals(n.LegacyValue, n.Value, StringComparison.Ordinal))
        {
            // Preserve what came in, so a lossy conversion stays reviewable in the editor.
            node["selectorLegacyValue"] = n.LegacyValue;
        }
        node["framePathJson"] = selector.FramePathJson;
        if (selector.IsDynamic)
        {
            node["selectorIsDynamic"] = true;
            if (!string.IsNullOrWhiteSpace(selector.DynamicColumn))
                node["selectorDynamicColumn"] = selector.DynamicColumn;
            if (selector.DynamicSourceId is int dynSrc && dynSrc > 0)
                node["selectorDataSourceId"] = dynSrc;
        }
        var notes = new List<string>(n.Notes);
        notes.AddRange(selector.ExtraNotes);
        if (notes.Count > 0)
            node["selectorNotes"] = new JsonArray(notes.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray());
    }

    /// <summary>
    /// Load one legacy selector row. The Windows-era schema stored an explicit Selenium matcher
    /// (<c>ElementBy</c> + <c>ElementByValue</c>) plus a '|' frame chain; the mid schema stored a
    /// single free-text <c>ElementValue</c> and <c>FramePathJson</c>. Every column is probed so
    /// either shape converts.
    /// </summary>
    private static async Task<Sel?> LoadSelectorAsync(SqlConnection conn, int id, CancellationToken ct)
    {
        if (!await TableExistsAsync(conn, "Selectors", ct)) return null;

        var hasLegacy = await ColumnExistsAsync(conn, "Selectors", "ElementByValue", ct);
        var hasElementValue = await ColumnExistsAsync(conn, "Selectors", "ElementValue", ct);
        var hasFramePath = await ColumnExistsAsync(conn, "Selectors", "FramePathJson", ct);
        var hasFrameBy = await ColumnExistsAsync(conn, "Selectors", "FrameBy", ct);
        var hasDyn = await ColumnExistsAsync(conn, "Selectors", "IsDynamci", ct);
        var hasDynCol = await ColumnExistsAsync(conn, "Selectors", "DynamciSourceColumnName", ct);
        var hasDynSrc = await ColumnExistsAsync(conn, "Selectors", "ElementSourceId", ct);

        var sql = "SELECT Id"
            + (hasLegacy ? ", ElementBy, ElementByValue"
                : hasElementValue ? ", CAST(NULL AS nvarchar(50)) AS ElementBy, ElementValue"
                : ", CAST(NULL AS nvarchar(50)) AS ElementBy, CAST(NULL AS nvarchar(max)) AS ElementByValue")
            + (hasFramePath ? ", FramePathJson" : ", CAST(NULL AS nvarchar(max)) AS FramePathJson")
            + (hasFrameBy ? ", FrameBy, FrameByValue"
                : ", CAST(NULL AS nvarchar(50)) AS FrameBy, CAST(NULL AS nvarchar(max)) AS FrameByValue")
            + (hasDyn ? ", IsDynamci" : ", CAST(0 AS bit) AS IsDynamci")
            + (hasDynCol ? ", DynamciSourceColumnName" : ", CAST(NULL AS nvarchar(200)) AS DynamciSourceColumnName")
            + (hasDynSrc ? ", ElementSourceId" : ", CAST(NULL AS int) AS ElementSourceId")
            + " FROM Selectors WHERE Id = @id";

        await using var cmd = new SqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;

        var elementBy = r.IsDBNull(1) ? null : Convert.ToString(r.GetValue(1));
        var value = r.IsDBNull(2) ? string.Empty : Convert.ToString(r.GetValue(2)) ?? string.Empty;
        var framePathJson = r.IsDBNull(3) ? "[]" : Convert.ToString(r.GetValue(3)) ?? "[]";
        var frameBy = r.IsDBNull(4) ? null : Convert.ToString(r.GetValue(4));
        var frameByValue = r.IsDBNull(5) ? null : Convert.ToString(r.GetValue(5));
        var isDynamic = !r.IsDBNull(6) && Convert.ToBoolean(r.GetValue(6));
        var dynamicColumn = r.IsDBNull(7) ? null : Convert.ToString(r.GetValue(7));
        var dynamicSourceId = r.IsDBNull(8) ? (int?)null : Convert.ToInt32(r.GetValue(8));

        var notes = new List<string>();
        var normalized = hasLegacy
            ? LegacySelectorNormalizer.NormalizeTyped(elementBy, value)
            : LegacySelectorNormalizer.Normalize(value);

        if ((framePathJson == "[]" || string.IsNullOrWhiteSpace(framePathJson)) && !string.IsNullOrWhiteSpace(frameByValue))
            framePathJson = LegacySelectorNormalizer.BuildFramePathJson(frameBy, frameByValue, notes);

        if (isDynamic && normalized.Ok
            && !normalized.Value.Contains(LegacySelectorNormalizer.DynamicPlaceholder, StringComparison.Ordinal))
        {
            // The whole value came from the source column in the old editor; the new engine
            // resolves a selector template, so a bare placeholder is the faithful mapping.
            // A managed (unconvertible) selector is NOT overridden — it stays flagged for a fix.
            var adjusted = new LegacySelectorNormalizer.NormalizedSelector
            {
                By = normalized.By,
                Value = LegacySelectorNormalizer.DynamicPlaceholder,
                LegacyValue = normalized.LegacyValue
            };
            adjusted.Notes.AddRange(normalized.Notes);
            adjusted.Notes.Add("مقدار سلکتور در نسخهٔ قدیم کاملاً از منبع خوانده می‌شد؛ به نشانگر پویا تبدیل شد.");
            normalized = adjusted;
        }

        var sel = new Sel(value, framePathJson)
        {
            Normalized = normalized,
            IsDynamic = isDynamic,
            DynamicColumn = dynamicColumn,
            DynamicSourceId = dynamicSourceId
        };
        sel.ExtraNotes.AddRange(notes);
        return sel;
    }

    /// <summary>One legacy condition group with the conditions it contains.</summary>
    private sealed class LegacyConditionGroupRow
    {
        public int Id { get; init; }
        public string Title { get; init; } = "";
        public int? SuccessGroupId { get; init; }
        public int? FailedGroupId { get; init; }
        /// <summary>Legacy flag: a failed group stopped the surrounding loop.</summary>
        public bool BreakOnFaild { get; init; }
        /// <summary>Legacy flag: a passed group stopped the surrounding loop.</summary>
        public bool BreakOnSuccess { get; init; }
        public List<LegacySelectorNormalizer.LegacyCondition> Conditions { get; init; } = new();
    }

    /// <summary>
    /// Read a step's condition groups together with their conditions.
    ///
    /// The legacy schema's exact columns vary between versions, so every optional column is probed
    /// before use. Columns the database does not have are simply skipped rather than crashing the
    /// import — a partial condition list is still better than no import at all.
    /// </summary>
    private static async Task<List<LegacyConditionGroupRow>> LoadConditionGroupsForStepAsync(
        SqlConnection conn, int stepId, CancellationToken ct)
    {
        var rows = new List<LegacyConditionGroupRow>();
        if (!await TableExistsAsync(conn, "ConditionGroups", ct)) return rows;

        var hasTitle = await ColumnExistsAsync(conn, "ConditionGroups", "Title", ct);
        var hasSuccess = await ColumnExistsAsync(conn, "ConditionGroups", "SuccessGroupId", ct);
        // The Windows-era schema misspelled it: FaildGroupId.
        var hasFaild = await ColumnExistsAsync(conn, "ConditionGroups", "FaildGroupId", ct);
        var hasFailed = await ColumnExistsAsync(conn, "ConditionGroups", "FailedGroupId", ct);
        var hasActive = await ColumnExistsAsync(conn, "ConditionGroups", "IsActive", ct);
        var hasBreakFaild = await ColumnExistsAsync(conn, "ConditionGroups", "BreakLoopOnfaild", ct);
        var hasBreakSuccess = await ColumnExistsAsync(conn, "ConditionGroups", "BreakLoopOnSuccess", ct);

        var sql = "SELECT Id"
            + (hasTitle ? ", Title" : ", CAST(NULL AS nvarchar(200)) AS Title")
            + (hasSuccess ? ", SuccessGroupId" : ", CAST(NULL AS int) AS SuccessGroupId")
            + (hasFaild ? ", FaildGroupId" : hasFailed ? ", FailedGroupId" : ", CAST(NULL AS int) AS FaildGroupId")
            + (hasActive ? ", IsActive" : ", CAST(1 AS bit) AS IsActive")
            + (hasBreakFaild ? ", BreakLoopOnfaild" : ", CAST(0 AS bit) AS BreakLoopOnfaild")
            + (hasBreakSuccess ? ", BreakLoopOnSuccess" : ", CAST(0 AS bit) AS BreakLoopOnSuccess")
            + " FROM ConditionGroups WHERE StepId = @sid ORDER BY Id";

        await using (var cmd = new SqlCommand(sql, conn))
        {
            cmd.Parameters.AddWithValue("@sid", stepId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                if (!r.IsDBNull(4) && !r.GetBoolean(4)) continue;   // IsActive
                rows.Add(new LegacyConditionGroupRow
                {
                    Id = r.GetInt32(0),
                    Title = r.IsDBNull(1) ? "" : Convert.ToString(r.GetValue(1)) ?? "",
                    SuccessGroupId = r.IsDBNull(2) ? null : r.GetInt32(2),
                    FailedGroupId = r.IsDBNull(3) ? null : r.GetInt32(3),
                    BreakOnFaild = !r.IsDBNull(5) && r.GetBoolean(5),
                    BreakOnSuccess = !r.IsDBNull(6) && r.GetBoolean(6)
                });
            }
        }

        foreach (var row in rows)
        {
            row.Conditions.AddRange(await LoadConditionsAsync(conn, row.Id, ct));
        }
        return rows;
    }

    /// <summary>Read the individual conditions inside one legacy condition group.</summary>
    private static async Task<List<LegacySelectorNormalizer.LegacyCondition>> LoadConditionsAsync(
        SqlConnection conn, int conditionGroupId, CancellationToken ct)
    {
        var list = new List<LegacySelectorNormalizer.LegacyCondition>();
        if (!await TableExistsAsync(conn, "Conditions", ct)) return list;

        var hasTitle = await ColumnExistsAsync(conn, "Conditions", "Title", ct);
        var hasType = await ColumnExistsAsync(conn, "Conditions", "ConditionType", ct);
        // The Windows-era schema misspelled it: EqulityType.
        var hasEqualityLegacy = await ColumnExistsAsync(conn, "Conditions", "EqulityType", ct);
        var hasEquality = await ColumnExistsAsync(conn, "Conditions", "EqualityType", ct);
        var hasSelectorId = await ColumnExistsAsync(conn, "Conditions", "SelectorId", ct);
        var hasSelector = await ColumnExistsAsync(conn, "Conditions", "SelectorValue", ct);
        var hasConstantLegacy = await ColumnExistsAsync(conn, "Conditions", "ConstantEqualValue", ct);
        var hasConstant = await ColumnExistsAsync(conn, "Conditions", "ConstantValue", ct);
        var hasColumnLegacy = await ColumnExistsAsync(conn, "Conditions", "DynamicSourceColumnName", ct);
        var hasColumn = await ColumnExistsAsync(conn, "Conditions", "ColumnName", ct);
        var hasJoin = await ColumnExistsAsync(conn, "Conditions", "Join", ct);
        var hasJoinAlt = await ColumnExistsAsync(conn, "Conditions", "LogicalOperator", ct);
        var hasIsOr = await ColumnExistsAsync(conn, "Conditions", "IsOr", ct);
        var hasNavigation = await ColumnExistsAsync(conn, "Conditions", "Navigation", ct);
        var hasCondActive = await ColumnExistsAsync(conn, "Conditions", "IsActive", ct);
        var hasSourceId = await ColumnExistsAsync(conn, "Conditions", "SourceId", ct);

        var sql = "SELECT Id"
            + (hasTitle ? ", Title" : ", CAST(NULL AS nvarchar(200)) AS Title")
            + (hasType ? ", ConditionType" : ", CAST(NULL AS nvarchar(50)) AS ConditionType")
            + (hasEqualityLegacy ? ", EqulityType" : hasEquality ? ", EqualityType" : ", CAST(NULL AS nvarchar(50)) AS EqualityType")
            + (hasSelectorId ? ", SelectorId" : ", CAST(NULL AS int) AS SelectorId")
            + (hasSelector ? ", SelectorValue" : ", CAST(NULL AS nvarchar(max)) AS SelectorValue")
            + (hasConstantLegacy ? ", ConstantEqualValue" : hasConstant ? ", ConstantValue" : ", CAST(NULL AS nvarchar(max)) AS ConstantValue")
            + (hasColumnLegacy ? ", DynamicSourceColumnName" : hasColumn ? ", ColumnName" : ", CAST(NULL AS nvarchar(200)) AS ColumnName")
            + (hasJoin ? ", [Join]" : hasJoinAlt ? ", LogicalOperator AS [Join]" : ", CAST(NULL AS nvarchar(20)) AS [Join]")
            + (hasIsOr ? ", IsOr" : ", CAST(0 AS bit) AS IsOr")
            + (hasNavigation ? ", Navigation" : ", CAST(NULL AS nvarchar(max)) AS Navigation")
            + (hasCondActive ? ", IsActive" : ", CAST(1 AS bit) AS IsActive")
            + (hasSourceId ? ", SourceId" : ", CAST(NULL AS int) AS SourceId")
            + " FROM Conditions WHERE ConditionGroupId = @cg ORDER BY Id";

        // Phase 1: read every condition row without opening a nested reader — a nested
        // ExecuteReader on the same connection throws without MARS, and the catch below would
        // silently drop the whole condition list.
        var raw = new List<(int? SelectorId, string? SelectorText, string? Title, string? Type,
            string? Equality, string? Constant, string? Column, bool IsOr, string? Join, string? Navigation,
            bool Active, int? SourceId)>();
        await using (var cmd = new SqlCommand(sql, conn))
        {
            cmd.Parameters.AddWithValue("@cg", conditionGroupId);
            try
            {
                await using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct))
                {
                    // Column order matches the SELECT above:
                    // 0 Id | 1 Title | 2 ConditionType | 3 EqualityType | 4 SelectorId
                    // 5 SelectorValue | 6 ConstantValue | 7 ColumnName | 8 Join | 9 IsOr | 10 Navigation | 11 IsActive | 12 SourceId
                    raw.Add((
                        r.IsDBNull(4) ? (int?)null : r.GetInt32(4),
                        r.IsDBNull(5) ? null : Convert.ToString(r.GetValue(5)),
                        r.IsDBNull(1) ? null : Convert.ToString(r.GetValue(1)),
                        r.IsDBNull(2) ? null : Convert.ToString(r.GetValue(2)),
                        r.IsDBNull(3) ? null : Convert.ToString(r.GetValue(3)),
                        r.IsDBNull(6) ? null : Convert.ToString(r.GetValue(6)),
                        r.IsDBNull(7) ? null : Convert.ToString(r.GetValue(7)),
                        !r.IsDBNull(9) && Convert.ToBoolean(r.GetValue(9)),
                        r.IsDBNull(8) ? null : Convert.ToString(r.GetValue(8)),
                        r.IsDBNull(10) ? null : Convert.ToString(r.GetValue(10)),
                        !r.IsDBNull(11) && Convert.ToBoolean(r.GetValue(11)),
                        r.IsDBNull(12) ? (int?)null : r.GetInt32(12)
                    ));
                }
            }
            catch
            {
                // A malformed legacy Conditions table must not abort the whole import.
                return list;
            }
        }

        // Phase 2: resolve selector text and build the mapped rows (safe — no reader is open).
        // The old engine's Passed() only evaluates ACTIVE conditions — an inactive condition is
        // ignored (and a group left without active conditions always passes). Mirror that here.
        foreach (var row in raw)
        {
            if (!row.Active) continue;
            var selectorText = row.SelectorText;
            if (string.IsNullOrWhiteSpace(selectorText) && row.SelectorId is int sid2)
            {
                var sel = await LoadSelectorAsync(conn, sid2, ct);
                if (sel is not null) selectorText = sel.Value;
            }

            var constantText = row.Constant;
            // A url condition stored its target in Navigation rather than the constant column.
            if (string.IsNullOrWhiteSpace(constantText)
                && !string.IsNullOrWhiteSpace(row.Navigation)
                && string.Equals(row.Type?.Trim(), "url", StringComparison.OrdinalIgnoreCase))
                constantText = row.Navigation;

            list.Add(new LegacySelectorNormalizer.LegacyCondition
            {
                Title = row.Title,
                ConditionType = row.Type,
                EqualityType = row.Equality,
                SelectorValue = selectorText,
                ConstantValue = constantText,
                ColumnName = row.Column,
                SourceId = row.SourceId,
                // The Windows-era schema stored the OR flag as a bit, not a join word.
                Join = row.IsOr ? "or" : row.Join
            });
        }
        return list;
    }

    /// <summary>
    /// Write a mapped condition plan onto a condition node in the shape the current editor reads.
    /// </summary>
    private static void ApplyConditionPlan(
        JsonObject node, LegacySelectorNormalizer.ConditionGroupPlan plan)
    {
        var conditions = new JsonArray();
        foreach (var c in plan.AndChain) conditions.Add(ConditionJson(c));
        foreach (var branch in plan.OrBranches)
        {
            foreach (var c in branch) conditions.Add(ConditionJson(c));
        }

        node["conditions"] = conditions;
        // AND = consecutive; OR = parallel branches. The editor uses this to render the split.
        node["andCount"] = plan.AndChain.Count;
        node["orBranchCount"] = plan.OrBranches.Count;
        node["isMixed"] = plan.IsMixed;

        if (plan.OrBranches.Count > 0)
        {
            var branches = new JsonArray();
            foreach (var branch in plan.OrBranches)
            {
                var b = new JsonArray();
                foreach (var c in branch) b.Add(ConditionJson(c));
                branches.Add(b);
            }
            node["orBranches"] = branches;
        }

        var notes = new List<string>(plan.Notes);
        foreach (var c in plan.AndChain) notes.AddRange(c.Notes);
        foreach (var branch in plan.OrBranches) foreach (var c in branch) notes.AddRange(c.Notes);
        if (notes.Count > 0)
            node["conditionNotes"] = new JsonArray(notes.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray());

        // Keep the legacy scalars on the node too — the current condition UI reads these directly.
        if (plan.AndChain.Count > 0)
        {
            var first = plan.AndChain[0];
            node["conditionType"] = first.ConditionType.ToString();
            node["equalityType"] = first.EqualityType.ToString();
            if (first.ConstantValue is not null) node["constantEqualValue"] = first.ConstantValue;
            if (first.ColumnName is not null) node["dynamicSourceColumnName"] = first.ColumnName;
            if (first.SourceId is int firstSrc && firstSrc > 0) node["dataSourceId"] = firstSrc;
            if (first.Selector is not null)
            {
                node["selectorValue"] = first.Selector.Value;
                if (first.Selector.Managed)
                    node["selectorNeedsReview"] = true;
                if (!string.IsNullOrWhiteSpace(first.Selector.LegacyValue)
                    && !string.Equals(first.Selector.LegacyValue, first.Selector.Value, StringComparison.Ordinal))
                    node["selectorLegacyValue"] = first.Selector.LegacyValue;
            }
        }
    }

    private static JsonObject ConditionJson(LegacySelectorNormalizer.MappedCondition c)
    {
        var o = new JsonObject
        {
            ["title"] = c.Title,
            ["conditionType"] = c.ConditionType.ToString(),
            ["equalityType"] = c.EqualityType.ToString()
        };
        if (c.ConstantValue is not null) o["constantValue"] = c.ConstantValue;
        if (c.ColumnName is not null) o["columnName"] = c.ColumnName;
        if (c.SourceId is int csid && csid > 0) o["dataSourceId"] = csid;
        if (c.Selector is not null)
        {
            o["selectorValue"] = c.Selector.Value;
            if (c.Selector.Managed)
                o["selectorNeedsReview"] = true;
            if (!string.IsNullOrWhiteSpace(c.Selector.LegacyValue))
                o["selectorLegacyValue"] = c.Selector.LegacyValue;
        }
        return o;
    }

    private static async Task<Act?> LoadActionAsync(SqlConnection conn, int id, CancellationToken ct)
    {
        if (!await TableExistsAsync(conn, "Actions", ct)) return null;

        var hasContent = await ColumnExistsAsync(conn, "Actions", "ContentSourceType", ct);
        var hasColumn = await ColumnExistsAsync(conn, "Actions", "DynamicSourceColumnName", ct);
        var hasSaveSrc = await ColumnExistsAsync(conn, "Actions", "SaveSourceId", ct);
        var hasRowIdx = await ColumnExistsAsync(conn, "Actions", "RowIndexType", ct);
        var hasWait = await ColumnExistsAsync(conn, "Actions", "WaitTimeDuration", ct);
        var hasSelector = await ColumnExistsAsync(conn, "Actions", "SelectorId", ct);

        var sql = "SELECT ActionType, ConstantValue, NavigateUrl"
            + (hasContent ? ", ContentSourceType" : ", CAST(NULL AS nvarchar(50)) AS ContentSourceType")
            + (hasColumn ? ", DynamicSourceColumnName" : ", CAST(NULL AS nvarchar(200)) AS DynamicSourceColumnName")
            + (hasSaveSrc ? ", SaveSourceId" : ", CAST(NULL AS int) AS SaveSourceId")
            + (hasRowIdx ? ", RowIndexType" : ", CAST(NULL AS nvarchar(50)) AS RowIndexType")
            + (hasWait ? ", WaitTimeDuration" : ", CAST(NULL AS int) AS WaitTimeDuration")
            + (hasSelector ? ", SelectorId" : ", CAST(NULL AS int) AS SelectorId")
            + " FROM Actions WHERE Id = @id";

        // 0 ActionType | 1 ConstantValue | 2 NavigateUrl | 3 ContentSourceType | 4 DynamicSourceColumnName
        // 5 SaveSourceId | 6 RowIndexType | 7 WaitTimeDuration | 8 SelectorId
        string rawType; string? cv, nu, content, column, rowIdx; int? saveSrc, wait, selectorId;
        await using (var cmd = new SqlCommand(sql, conn))
        {
            cmd.Parameters.AddWithValue("@id", id);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return null;
            rawType = r.IsDBNull(0) ? "NoAction" : Convert.ToString(r.GetValue(0)) ?? "NoAction";
            cv = r.IsDBNull(1) ? null : Convert.ToString(r.GetValue(1));
            nu = r.IsDBNull(2) ? null : Convert.ToString(r.GetValue(2));
            content = r.IsDBNull(3) ? null : Convert.ToString(r.GetValue(3));
            column = r.IsDBNull(4) ? null : Convert.ToString(r.GetValue(4));
            saveSrc = r.IsDBNull(5) ? null : Convert.ToInt32(r.GetValue(5));
            rowIdx = r.IsDBNull(6) ? null : Convert.ToString(r.GetValue(6));
            wait = r.IsDBNull(7) ? null : Convert.ToInt32(r.GetValue(7));
            selectorId = r.IsDBNull(8) ? null : Convert.ToInt32(r.GetValue(8));
        }

        var legacy = rawType.Trim();
        if (int.TryParse(legacy, out var atN) && Enum.IsDefined(typeof(Domain.Enums.ActionType), atN))
            legacy = ((Domain.Enums.ActionType)atN).ToString();

        Sel? sel = selectorId is int sid ? await LoadSelectorAsync(conn, sid, ct) : null;

        var (kind, closeTarget, notes) = MapLegacyActionType(legacy);
        var result = new Act
        {
            Kind = kind,
            LegacyActionType = string.Equals(kind, legacy, StringComparison.OrdinalIgnoreCase) ? null : legacy,
            ConstantValue = cv,
            NavigateUrl = nu,
            Selector = sel,
            ContentSourceType = content,
            DynamicColumn = column,
            SaveSourceId = saveSrc,
            RowIndexType = rowIdx,
            WaitMs = wait,
            CloseTabTarget = closeTarget
        };
        result.Notes.AddRange(notes);
        return result;
    }

    /// <summary>
    /// Map a legacy ActionType name onto the current ActionType enum.
    ///
    /// The old vocabulary is the same idea under older names (dbClick, closeLastDriverTab, …), and
    /// a few actions were retired in the current product. A retired action becomes NoAction so the
    /// step keeps its place in the chain, the legacy name is kept on the node, and the reason is
    /// recorded — the operator resolves it afterwards.
    /// </summary>
    private static (string Kind, string? CloseTabTarget, List<string> Notes) MapLegacyActionType(string legacy)
    {
        var notes = new List<string>();
        var key = legacy.Trim().ToLowerInvariant();
        switch (key)
        {
            case "click": return ("Click", null, notes);
            case "dbclick": return ("DoubleClick", null, notes);
            case "rightclick": return ("RightClick", null, notes);
            case "hover": return ("Hover", null, notes);
            case "hold": return ("Hold", null, notes);
            case "alertaccept": return ("AlertAccept", null, notes);
            case "inputcontent": return ("InputContent", null, notes);
            case "gotourl": return ("GoToUrl", null, notes);
            case "refresh": return ("Refresh", null, notes);
            case "waitforloading": return ("WaitForLoading", null, notes);
            case "waittime": return ("WaitTime", null, notes);
            case "removeelements": return ("RemoveElements", null, notes);
            case "noaction": return ("NoAction", null, notes);
            case "closelastdrivertab":
                notes.Add("در نسخهٔ قدیم آخرین تب بسته می‌شد؛ نود «بستن تب» با هدف «آخرین تب» ساخته شد.");
                return ("CloseTab", "Last", notes);
            case "closefirstdrivertab":
                notes.Add("در نسخهٔ قدیم اولین تب بسته می‌شد؛ نود «بستن تب» با هدف «اولین تب» ساخته شد.");
                return ("CloseTab", "First", notes);
            case "savecontent":
                notes.Add("در نسخهٔ قدیم مقدار از صفحه خوانده و در سلول منبع ذخیره می‌شد؛ به «درج در سلول منبع» نگاشت شد.");
                return ("InsertContent", null, notes);
            case "insertcontent":
                notes.Add("در نسخهٔ قدیم ابتدا ردیفی در انتهای منبع ساخته و مقدار در آن درج می‌شد؛ به «درج در سلول منبع» نگاشت شد — در صورت نیاز نود «درج ردیف» را دستی اضافه کنید.");
                return ("InsertContent", null, notes);
            case "takecontent":
                notes.Add("در نسخهٔ قدیم مقدار از منبع خوانده و در فیلد صفحه نوشته می‌شد؛ به «پر کردن فیلد» با منبع مقدار نگاشت شد.");
                return ("InputContent", null, notes);
            case "loadcontent":
                notes.Add("«بارگذاری محتوا» در نسخهٔ قدیم متن المان را برای ذخیرهٔ بعدی نگه می‌داشت؛ نزدیک‌ترین نود فعلی انتخاب شد.");
                return ("LoadContent", null, notes);
            case "newpage":
                notes.Add("«صفحهٔ جدید» معادل دقیقی در موتور فعلی ندارد؛ نود بدون اقدام جای آن گذاشته شد.");
                return ("NoAction", null, notes);
            case "enter":
                notes.Add("«Enter» به‌عنوان اکشن مستقل در نرم‌افزار فعلی حذف شده است؛ نود بدون اقدام جای آن گذاشته شد.");
                return ("NoAction", null, notes);
            case "loadcaptcha":
                notes.Add("«بارگذاری کپچا» در موتور فعلی وجود ندارد؛ نود بدون اقدام جای آن گذاشته شد.");
                return ("NoAction", null, notes);
            case "breakpoint":
                notes.Add("«breakpoint» در نسخهٔ قدیم هم عملی انجام نمی‌داد؛ به «بدون اقدام» نگاشت شد.");
                return ("NoAction", null, notes);
        }

        if (Enum.TryParse<Domain.Enums.ActionType>(legacy.Trim(), true, out var parsed))
            return (parsed.ToString(), null, notes);

        notes.Add($"نوع اقدام «{legacy}» در نرم‌افزار فعلی شناخته‌شده نیست؛ نود بدون اقدام جای آن گذاشته شد.");
        return ("NoAction", null, notes);
    }

    /// <summary>Map a legacy RowIndexType onto the editor's pointer vocabulary (typos included).</summary>
    private static string? MapRowPointer(string? legacy)
    {
        var key = (legacy ?? string.Empty).Trim().ToLowerInvariant();
        return key switch
        {
            "lastrow" => "LastRow",
            "curruntloop" or "currentloop" => "CurrentLoop",
            "parrentloop" or "parentloop" => "ParentLoop",
            "totalloop" => "TotalLoop",
            "firstrow" => "FirstRow",
            _ => null
        };
    }

    private static async Task<JsonArray> LoadDataSourcesAsync(SqlConnection conn, int taskId, CancellationToken ct)
    {
        var arr = new JsonArray();
        if (!await TableExistsAsync(conn, "TaskDataSources", ct)) return arr;
        // The Windows-era schema has no DataSources/DataSourceCells pair (its sources live in
        // GroupDataSources/DataSourceRows); nothing to merge there.
        if (!await TableExistsAsync(conn, "DataSources", ct) || !await TableExistsAsync(conn, "DataSourceCells", ct))
            return arr;

        // Both spellings of the link columns exist across schema versions.
        var hasTasksId = await ColumnExistsAsync(conn, "TaskDataSources", "TasksId", ct);
        var hasTaskId = await ColumnExistsAsync(conn, "TaskDataSources", "TaskId", ct);
        var hasDsId = await ColumnExistsAsync(conn, "TaskDataSources", "DataSourcesId", ct);
        var hasDataSourceId = await ColumnExistsAsync(conn, "TaskDataSources", "DataSourceId", ct);
        if ((!hasTasksId && !hasTaskId) || (!hasDsId && !hasDataSourceId)) return arr;

        var tasksCol = hasTasksId ? "TasksId" : "TaskId";
        var dsCol = hasDsId ? "DataSourcesId" : "DataSourceId";

        var ids = new List<int>();
        await using (var cmd = new SqlCommand(
                         $"SELECT {dsCol} FROM TaskDataSources WHERE {tasksCol} = @id", conn))
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
