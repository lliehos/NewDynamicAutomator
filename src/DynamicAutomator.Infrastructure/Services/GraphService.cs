using System.Text.Json;
using DynamicAutomator.Contracts.Tasks;
using DynamicAutomator.Domain.Entities;
using DynamicAutomator.Domain.Enums;
using DynamicAutomator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DynamicAutomator.Infrastructure.Services;

public class GraphService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private readonly AppDbContext _db;
    private readonly TaskService _tasks;

    public GraphService(AppDbContext db, TaskService tasks)
    {
        _db = db;
        _tasks = tasks;
    }

    public async Task<TaskGraphDto?> GetAsync(int userId, int taskId, CancellationToken ct = default)
    {
        if (!await _tasks.CanViewAsync(userId, taskId, ct))
            return null;

        var task = await _db.Tasks
            .Include(t => t.DataSources)
                .ThenInclude(d => d.Cells)
            .Include(t => t.Groups)
                .ThenInclude(g => g.Selector)
            .Include(t => t.Groups)
                .ThenInclude(g => g.Steps)
                    .ThenInclude(s => s.Action)
                        .ThenInclude(a => a!.Selector)
            .Include(t => t.Groups)
                .ThenInclude(g => g.Steps)
                    .ThenInclude(s => s.ConditionGroups)
            .FirstOrDefaultAsync(t => t.Id == taskId, ct);

        if (task is null)
            return null;

        var canModify = await _tasks.CanModifyAsync(userId, taskId, ct);
        var stored = string.IsNullOrWhiteSpace(task.CanvasJson)
            ? null
            : JsonSerializer.Deserialize<TaskGraphDto>(task.CanvasJson, JsonOpts);

        var pos = stored?.Nodes.ToDictionary(n => n.Id, n => n) ?? new Dictionary<string, GraphNodeDto>();
        var dto = new TaskGraphDto
        {
            TaskId = task.Id,
            Title = task.Title,
            CanModify = canModify,
            DesignOrigin = task.DesignOrigin.ToString(),
            Viewport = stored?.Viewport ?? new GraphViewportDto { Zoom = 1, X = 80, Y = 40 },
            DataSources = task.DataSources
                .OrderBy(d => d.Id)
                .Select(MapDataSourceRef)
                .ToList()
        };

        dto.Nodes.Add(new GraphNodeDto
        {
            Id = "start",
            Kind = "start",
            Title = "شروع",
            X = pos.GetValueOrDefault("start")?.X ?? 40,
            Y = pos.GetValueOrDefault("start")?.Y ?? 220
        });

        var groups = task.Groups.OrderBy(g => g.Priority).ThenBy(g => g.Id).ToList();
        var gx = 280;
        foreach (var group in groups)
        {
            var gid = $"group-{group.Id}";
            dto.Nodes.Add(new GraphNodeDto
            {
                Id = gid,
                Kind = "group",
                EntityId = group.Id,
                Title = group.Title,
                RepeatSourceType = group.SourceType.ToString(),
                MoveLoop = group.MoveLoop,
                DataSourceId = group.DataSourceId,
                SelectorValue = group.Selector?.ElementValue,
                FramePathJson = group.Selector?.FramePathJson,
                X = pos.GetValueOrDefault(gid)?.X ?? gx,
                Y = pos.GetValueOrDefault(gid)?.Y ?? 80
            });
            gx += 360;

            var steps = group.Steps.OrderBy(s => s.Priority).ThenBy(s => s.Id).ToList();
            GraphNodeDto? prevStep = null;
            var sy = 0;
            foreach (var step in steps)
            {
                var sid = $"step-{step.Id}";
                var node = new GraphNodeDto
                {
                    Id = sid,
                    Kind = "step",
                    EntityId = step.Id,
                    Title = step.Title,
                    GroupNodeId = gid,
                    ActionType = step.Action?.ActionType.ToString() ?? nameof(ActionType.NoAction),
                    IsConditional = step.IsConditional,
                    IsActive = step.IsActive,
                    SelectorValue = step.Action?.Selector?.ElementValue,
                    FramePathJson = step.Action?.Selector?.FramePathJson,
                    ConstantValue = step.Action?.ConstantValue,
                    NavigateUrl = step.Action?.NavigateUrl,
                    X = pos.GetValueOrDefault(sid)?.X ?? (dto.Nodes.Last(n => n.Id == gid).X + 28),
                    Y = pos.GetValueOrDefault(sid)?.Y ?? (dto.Nodes.Last(n => n.Id == gid).Y + 70 + sy)
                };
                dto.Nodes.Add(node);
                sy += 110;

                if (prevStep is null)
                    dto.Edges.Add(Edge($"e-g-{group.Id}", gid, sid, "contains"));
                else
                    dto.Edges.Add(Edge($"e-n-{prevStep.EntityId}-{step.Id}", prevStep.Id, sid, "next"));

                prevStep = node;

                foreach (var cg in step.ConditionGroups.Where(c => c.IsActive))
                {
                    var cid = $"cond-{cg.Id}";
                    dto.Nodes.Add(new GraphNodeDto
                    {
                        Id = cid,
                        Kind = "condition",
                        EntityId = cg.Id,
                        Title = string.IsNullOrWhiteSpace(cg.Title) ? "شرط" : cg.Title,
                        GroupNodeId = gid,
                        X = pos.GetValueOrDefault(cid)?.X ?? node.X + 220,
                        Y = pos.GetValueOrDefault(cid)?.Y ?? node.Y
                    });
                    dto.Edges.Add(Edge($"e-sc-{step.Id}-{cg.Id}", sid, cid, "next"));
                    if (cg.SuccessGroupId is int sg)
                        dto.Edges.Add(Edge($"e-ok-{cg.Id}", cid, $"group-{sg}", "success"));
                    if (cg.FailedGroupId is int fg)
                        dto.Edges.Add(Edge($"e-fail-{cg.Id}", cid, $"group-{fg}", "fail"));
                }
            }

            if (group.ParentGroupId is int pid)
                dto.Edges.Add(Edge($"e-p-{pid}-{group.Id}", $"group-{pid}", gid, "parent"));
        }

        var roots = groups.Where(g => g.ParentGroupId is null).OrderBy(g => g.Priority).ToList();
        if (roots.Count > 0)
            dto.Edges.Add(Edge("e-start", "start", $"group-{roots[0].Id}", "next"));

        return dto;
    }

    public async Task<TaskGraphDto> SaveAsync(int userId, int taskId, SaveTaskGraphRequest request, CancellationToken ct = default)
    {
        if (!await _tasks.CanModifyAsync(userId, taskId, ct))
            throw new UnauthorizedAccessException();

        var task = await _db.Tasks
            .Include(t => t.Groups).ThenInclude(g => g.Selector)
            .Include(t => t.Groups).ThenInclude(g => g.Steps).ThenInclude(s => s.Action)
            .Include(t => t.Groups).ThenInclude(g => g.Steps).ThenInclude(s => s.ConditionGroups)
            .FirstAsync(t => t.Id == taskId, ct);

        if (!string.IsNullOrWhiteSpace(request.Title))
            task.Title = request.Title.Trim();

        foreach (var id in request.DeletedConditionGroupIds.Distinct())
        {
            var cg = await _db.ConditionGroups.FirstOrDefaultAsync(x => x.Id == id && x.Step.Group!.TaskId == taskId, ct);
            if (cg != null) _db.ConditionGroups.Remove(cg);
        }
        foreach (var id in request.DeletedStepIds.Distinct())
        {
            var step = await _db.Steps.Include(s => s.Action).FirstOrDefaultAsync(x => x.Id == id && x.Group!.TaskId == taskId, ct);
            if (step != null) _db.Steps.Remove(step);
        }
        foreach (var id in request.DeletedGroupIds.Distinct())
        {
            var group = await _db.Groups.FirstOrDefaultAsync(x => x.Id == id && x.TaskId == taskId, ct);
            if (group != null) _db.Groups.Remove(group);
        }
        await _db.SaveChangesAsync(ct);

        var idMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var groupByNode = new Dictionary<string, Group>(StringComparer.OrdinalIgnoreCase);
        var stepByNode = new Dictionary<string, Step>(StringComparer.OrdinalIgnoreCase);
        var condByNode = new Dictionary<string, ConditionGroup>(StringComparer.OrdinalIgnoreCase);

        foreach (var node in request.Nodes.Where(n => n.Kind == "group"))
        {
            Group group;
            if (node.EntityId is int eid)
            {
                group = task.Groups.FirstOrDefault(g => g.Id == eid) ?? new Group { TaskId = taskId };
                if (group.Id == 0) _db.Groups.Add(group);
            }
            else
            {
                group = new Group { TaskId = taskId };
                _db.Groups.Add(group);
            }
            group.Title = string.IsNullOrWhiteSpace(node.Title) ? "گروه" : node.Title.Trim();
            if (Enum.TryParse<RepeatSourceType>(node.RepeatSourceType, true, out var rst))
                group.SourceType = rst;
            group.MoveLoop = node.MoveLoop;
            group.DataSourceId = node.DataSourceId > 0 ? node.DataSourceId : null;
            if (!string.IsNullOrWhiteSpace(node.SelectorValue) || !string.IsNullOrWhiteSpace(node.FramePathJson))
            {
                group.Selector ??= new Selector { ElementBy = SelectorBy.CssSelector };
                if (!string.IsNullOrWhiteSpace(node.SelectorValue))
                    group.Selector.ElementValue = node.SelectorValue.Trim();
                if (!string.IsNullOrWhiteSpace(node.FramePathJson))
                    group.Selector.FramePathJson = node.FramePathJson;
            }
            groupByNode[node.Id] = group;
        }
        await _db.SaveChangesAsync(ct);
        foreach (var kv in groupByNode)
            idMap[kv.Key] = $"group-{kv.Value.Id}";

        foreach (var node in request.Nodes.Where(n => n.Kind == "step"))
        {
            var parentId = node.GroupNodeId;
            Group? group = parentId != null && groupByNode.TryGetValue(parentId, out var g) ? g : task.Groups.OrderBy(x => x.Priority).FirstOrDefault();
            if (group is null)
            {
                group = new Group { TaskId = taskId, Title = "گروه" };
                _db.Groups.Add(group);
                await _db.SaveChangesAsync(ct);
            }

            Step step;
            if (node.EntityId is int eid)
                step = await _db.Steps.Include(s => s.Action).ThenInclude(a => a!.Selector)
                    .FirstOrDefaultAsync(s => s.Id == eid, ct) ?? new Step();
            else
                step = new Step();

            if (step.Id == 0)
            {
                step.Action = new StepAction();
                _db.Steps.Add(step);
            }
            step.GroupId = group.Id;
            step.Title = string.IsNullOrWhiteSpace(node.Title) ? "مرحله" : node.Title.Trim();
            step.IsConditional = node.IsConditional;
            step.IsActive = node.IsActive;
            step.Action ??= new StepAction();
            if (Enum.TryParse<ActionType>(node.ActionType, true, out var at))
                step.Action.ActionType = at;
            step.Action.ConstantValue = node.ConstantValue;
            step.Action.NavigateUrl = node.NavigateUrl;
            if (!string.IsNullOrWhiteSpace(node.SelectorValue) || !string.IsNullOrWhiteSpace(node.FramePathJson))
            {
                step.Action.Selector ??= new Selector { ElementBy = SelectorBy.CssSelector };
                if (!string.IsNullOrWhiteSpace(node.SelectorValue))
                    step.Action.Selector.ElementValue = node.SelectorValue;
                if (!string.IsNullOrWhiteSpace(node.FramePathJson))
                    step.Action.Selector.FramePathJson = node.FramePathJson;
            }
            stepByNode[node.Id] = step;
        }
        await _db.SaveChangesAsync(ct);
        foreach (var kv in stepByNode)
            idMap[kv.Key] = $"step-{kv.Value.Id}";

        foreach (var node in request.Nodes.Where(n => n.Kind == "condition"))
        {
            var incoming = request.Edges.FirstOrDefault(e => e.To == node.Id);
            Step? owner = null;
            if (incoming != null && stepByNode.TryGetValue(incoming.From, out var s))
                owner = s;
            if (owner is null) continue;

            ConditionGroup cg;
            if (node.EntityId is int eid)
                cg = await _db.ConditionGroups.FirstOrDefaultAsync(x => x.Id == eid, ct) ?? new ConditionGroup { StepId = owner.Id };
            else
                cg = new ConditionGroup { StepId = owner.Id };
            if (cg.Id == 0) _db.ConditionGroups.Add(cg);
            cg.StepId = owner.Id;
            cg.Title = string.IsNullOrWhiteSpace(node.Title) ? "شرط" : node.Title.Trim();
            cg.IsActive = true;
            condByNode[node.Id] = cg;
        }
        await _db.SaveChangesAsync(ct);

        var parentEdges = request.Edges.Where(e => e.Kind == "parent").ToList();
        foreach (var g in groupByNode.Values)
            g.ParentGroupId = null;
        foreach (var edge in parentEdges)
        {
            if (groupByNode.TryGetValue(edge.From, out var p) && groupByNode.TryGetValue(edge.To, out var c) && p.Id != c.Id)
                c.ParentGroupId = p.Id;
        }

        var pri = 1;
        foreach (var g in groupByNode.Values.OrderBy(x => x.ParentGroupId ?? 0).ThenBy(x => x.Id))
            g.Priority = pri++;

        foreach (var group in groupByNode.Values)
        {
            var stepNodes = request.Nodes.Where(n => n.Kind == "step" && n.GroupNodeId == groupByNode.First(x => x.Value.Id == group.Id).Key).Select(n => n.Id).ToHashSet();
            var next = request.Edges.Where(e => e.Kind == "next" && stepNodes.Contains(e.From) && stepNodes.Contains(e.To)).ToList();
            var ordered = Topo(stepNodes, next);
            var p = 1;
            foreach (var sid in ordered)
            {
                if (stepByNode.TryGetValue(sid, out var st))
                    st.Priority = p++;
            }
        }

        foreach (var kv in condByNode)
        {
            var ok = request.Edges.FirstOrDefault(e => e.From == kv.Key && e.Kind == "success");
            var fail = request.Edges.FirstOrDefault(e => e.From == kv.Key && e.Kind == "fail");
            kv.Value.SuccessGroupId = ok != null && groupByNode.TryGetValue(ok.To, out var sg) ? sg.Id : null;
            kv.Value.FailedGroupId = fail != null && groupByNode.TryGetValue(fail.To, out var fg) ? fg.Id : null;
        }

        var persist = new TaskGraphDto
        {
            TaskId = taskId,
            Title = task.Title,
            Viewport = request.Viewport,
            Nodes = request.Nodes.Select(n =>
            {
                var copy = n;
                if (idMap.TryGetValue(n.Id, out var mapped))
                    copy.Id = mapped;
                if (!string.IsNullOrEmpty(n.GroupNodeId) && idMap.TryGetValue(n.GroupNodeId, out var gmap))
                    copy.GroupNodeId = gmap;
                if (copy.Kind == "group" && groupByNode.TryGetValue(n.Id, out var g))
                    copy.EntityId = g.Id;
                if (copy.Kind == "step" && stepByNode.TryGetValue(n.Id, out var s))
                    copy.EntityId = s.Id;
                if (copy.Kind == "condition" && condByNode.TryGetValue(n.Id, out var c))
                    copy.EntityId = c.Id;
                return copy;
            }).ToList(),
            Edges = request.Edges
        };
        task.CanvasJson = JsonSerializer.Serialize(persist, JsonOpts);
        await _db.SaveChangesAsync(ct);

        return (await GetAsync(userId, taskId, ct))!;
    }

    private static GraphEdgeDto Edge(string id, string from, string to, string kind) =>
        new() { Id = id, From = from, To = to, Kind = kind };

    private static DataSourceRefDto MapDataSourceRef(DataSource d)
    {
        var keys = ReadColumnKeys(d.ColumnsJson);
        var rowCount = d.Cells.Count == 0 ? 0 : d.Cells.Max(c => c.RowIndex) + 1;
        return new DataSourceRefDto
        {
            Id = d.Id,
            Title = d.Title,
            ColumnCount = keys.Count,
            RowCount = rowCount,
            ColumnKeys = keys
        };
    }

    private static List<string> ReadColumnKeys(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<string>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return new List<string>();
            var list = new List<string>();
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (el.ValueKind == JsonValueKind.String)
                {
                    var s = el.GetString();
                    if (!string.IsNullOrWhiteSpace(s)) list.Add(s!);
                }
                else if (el.ValueKind == JsonValueKind.Object)
                {
                    var key = el.TryGetProperty("key", out var k) ? k.GetString()
                        : el.TryGetProperty("Key", out var k2) ? k2.GetString() : null;
                    if (!string.IsNullOrWhiteSpace(key)) list.Add(key!);
                }
            }
            return list;
        }
        catch
        {
            return new List<string>();
        }
    }

    private static List<string> Topo(HashSet<string> nodes, List<GraphEdgeDto> edges)
    {
        var incoming = nodes.ToDictionary(n => n, _ => 0);
        foreach (var e in edges)
        {
            if (incoming.ContainsKey(e.To) && incoming.ContainsKey(e.From))
                incoming[e.To]++;
        }
        var q = new Queue<string>(incoming.Where(kv => kv.Value == 0).Select(kv => kv.Key));
        var result = new List<string>();
        while (q.Count > 0)
        {
            var n = q.Dequeue();
            result.Add(n);
            foreach (var e in edges.Where(x => x.From == n && incoming.ContainsKey(x.To)))
            {
                incoming[e.To]--;
                if (incoming[e.To] == 0) q.Enqueue(e.To);
            }
        }
        foreach (var n in nodes.Where(x => !result.Contains(x)))
            result.Add(n);
        return result;
    }
}
