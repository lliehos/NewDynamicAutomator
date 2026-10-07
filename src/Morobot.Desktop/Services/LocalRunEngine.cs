using System.Text.Json;
using Morobot.Desktop.Models;
using OpenQA.Selenium;

namespace Morobot.Desktop.Services;

/// <summary>Live state of one run, surfaced to the run window.</summary>
public sealed class RunState
{
    public string ProcessTitle { get; set; } = "";
    public bool RunOnServer { get; set; } = true;
    public bool Running { get; set; }
    public bool Stopped { get; set; }
    public int StepIndex { get; set; }
    public int StepTotal { get; set; }
    public int LoopIndex { get; set; }
    public int LoopTotal { get; set; }
    public string? LastError { get; set; }
    public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;
    public List<RunLogLine> Log { get; } = new();
    /// <summary>Cells written locally, ready to be pushed by Sync.</summary>
    public List<LocalCellWrite> Writes { get; } = new();
}

public sealed record RunLogLine(DateTime AtUtc, string Kind, string Text);

public sealed record LocalCellWrite(int DataSourceId, int RowIndex, string ColumnKey, string? CellValue);

/// <summary>
/// Walks a process graph and executes it against a Firefox session.
/// </summary>
/// <remarks>
/// This is the desktop counterpart of the extension's play loop. It is deliberately single-process
/// per instance: the feature calls for running several processes at once, and the clean way to get
/// that is several independent runs, each with its own engine and its own browser — not one engine
/// juggling tabs, which is where the extension's complexity comes from.
///
/// Server participation follows the process's own switch. Server mode registers the play and keeps
/// the server's sources authoritative. Local mode never registers, and reads/writes non-shared
/// sources from the values the run itself carries, so the run is unaffected by the server being
/// slow or unreachable. Shared sources stay server-backed in both modes, because their whole point
/// is that everyone sees the same values.
/// </remarks>
public sealed class LocalRunEngine
{
    private readonly ActionExecutor _actions = new();
    private readonly PanelClient _client;
    private readonly FirefoxRunner _browser;
    private readonly bool _allowServerCalls;

    private readonly Dictionary<string, string> _memory = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _localCells = new(StringComparer.Ordinal);

    public RunState State { get; } = new();
    public event Action? Changed;

    private CancellationTokenSource? _cts;

    public LocalRunEngine(PanelClient client, FirefoxRunner browser, bool runOnServer)
    {
        _client = client;
        _browser = browser;
        // A local run must work with no server at all, so its calls are switched off wholesale
        // rather than each being wrapped in a try/catch that would mask a real bug.
        _allowServerCalls = runOnServer;
        State.RunOnServer = runOnServer;
    }

    public bool IsRunning => State.Running;

    public void Stop()
    {
        State.Stopped = true;
        _cts?.Cancel();
    }

    public async Task StartAsync(
        ProcessGraph graph,
        IReadOnlyList<int> rowIndices,
        bool headless = false,
        CancellationToken external = default)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(external);
        var ct = _cts.Token;
        State.Running = true;
        State.Stopped = false;
        State.LastError = null;
        State.ProcessTitle = graph.Title ?? "";
        State.StartedAtUtc = DateTime.UtcNow;
        State.Log.Clear();
        State.Writes.Clear();
        _localCells.Clear();
        Log("info", State.RunOnServer ? "شروع اجرا (حالت سرور)" : "شروع اجرا (حالت محلی)");

        var taskId = ReadTaskId(graph);
        var registered = false;
        try
        {
            _browser.Start(headless);
            ApplyStartNodeSettings(graph);

            if (State.RunOnServer && _allowServerCalls && taskId > 0)
            {
                registered = await _client.RegisterPlayAsync(taskId, ct);
                if (!registered)
                    Log("warn", "ثبت اجرا روی سرور انجام نشد؛ اجرا ادامه می‌یابد.");
            }
            else if (taskId > 0)
            {
                Log("info", "این اجرا روی سرور ثبت نمی‌شود.");
            }

            await WalkAsync(graph, rowIndices, ct);
            if (State.Stopped)
                Log("warn", "اجرا توسط کاربر متوقف شد.");
            else if (State.LastError is null)
                Log("info", $"اجرا با موفقیت تمام شد ({State.LoopTotal} حلقه).");
        }
        catch (OperationCanceledException)
        {
            State.Stopped = true;
            Log("warn", "اجرا متوقف شد.");
        }
        catch (Exception ex)
        {
            State.LastError = ex.Message;
            Log("error", $"خطای اجرا: {ex.Message}");
        }
        finally
        {
            State.Running = false;
            if (registered && taskId > 0)
                await _client.UnregisterPlayAsync(taskId);
            Changed?.Invoke();
        }
    }

    private void ApplyStartNodeSettings(ProcessGraph graph)
    {
        var start = graph.StartNode;
        if (start is null) return;
        // Step gap and the loop guard live on the process-level start node, exactly as they do in the
        // editor; reading them here keeps one source of truth for both clients.
        if (start.Extra.TryGetValue("stepDelayMs", out var d) && d.TryGetInt32(out var ms))
            graph.StepDelayMs = ms;
        if (start.Extra.TryGetValue("loopBackLimit", out var l) && l.TryGetInt32(out var lim) && lim > 0)
            graph.LoopBackLimit = lim;
    }

    /// <summary>
    /// Walk the graph once per selected row index.
    /// </summary>
    /// <remarks>
    /// The row index is what a source-driven process iterates: each iteration is one row of the
    /// default source, and a step that reads "the current row" gets that row. Selected indices come
    /// from the run dialog, so a user can run one row, a range, or all of them.
    /// </remarks>
    private async Task WalkAsync(ProcessGraph graph, IReadOnlyList<int> rowIndices, CancellationToken ct)
    {
        var rows = rowIndices.Count > 0 ? rowIndices : new List<int> { 0 };
        State.LoopTotal = rows.Count;

        for (var li = 0; li < rows.Count; li++)
        {
            ct.ThrowIfCancellationRequested();
            if (State.Stopped) return;
            State.LoopIndex = li + 1;
            var rowIndex = rows[li];
            Log("info", $"──── حلقه {li + 1} / {rows.Count} (ردیف {rowIndex + 1}) ────");
            Changed?.Invoke();

            var start = graph.StartNode;
            if (start is null)
            {
                State.LastError = "نود شروع در فرآیند پیدا نشد.";
                Log("error", State.LastError);
                return;
            }

            var visited = new Dictionary<string, int>(StringComparer.Ordinal);
            var currentId = start.Id;
            while (!string.IsNullOrEmpty(currentId))
            {
                ct.ThrowIfCancellationRequested();
                if (State.Stopped) return;

                // A loop back to a node we have already been through many times means the graph's
                // exit condition never became true; stop rather than spin forever.
                visited.TryGetValue(currentId, out var hits);
                if (hits > graph.LoopBackLimit)
                {
                    State.LastError = $"تعداد تکرار از حد مجاز ({graph.LoopBackLimit}) گذشت.";
                    Log("error", State.LastError);
                    return;
                }
                visited[currentId] = hits + 1;

                var node = graph.NodeById(currentId);
                if (node is null) return;
                if (node.IsActive == false)
                {
                    Log("info", $"نود غیرفعال رد شد: {node.Title ?? node.Id}");
                    currentId = graph.NextNodeId(currentId, null);
                    continue;
                }
                if (node.IsEnd) return;

                if (node.IsCondition)
                {
                    var passed = EvaluateCondition(graph, node, rowIndex);
                    Log(passed ? "info" : "warn",
                        $"نتیجه شرط «{node.Title ?? node.Id}»: {(passed ? "برقرار" : "برقرار نیست")}");
                    currentId = graph.NextNodeId(currentId, passed);
                    continue;
                }

                if (node.IsAction)
                {
                    var outcome = await RunActionAsync(graph, node, rowIndex, ct);
                    if (!outcome.Ok)
                    {
                        State.LastError = outcome.Error;
                        Log("error", $"خطا در «{node.Title ?? node.Id}»: {outcome.Error}");
                        return;
                    }
                }

                currentId = graph.NextNodeId(currentId, null);
                if (graph.StepDelayMs > 0)
                    await Task.Delay(graph.StepDelayMs, ct);
            }
        }
    }

    private async Task<StepOutcome> RunActionAsync(ProcessGraph graph, GraphNode node, int rowIndex, CancellationToken ct)
    {
        State.StepIndex++;
        Changed?.Invoke();
        var label = node.Title ?? node.ActionType ?? node.Id;
        Log("info", $"اجرای «{label}»");

        var value = ResolveValue(graph, node, rowIndex);

        // Actions that only write into a source never touch the page.
        var action = node.ActionType ?? "";
        if (action is "SetMemory")
        {
            var name = node.MemoryVariableName ?? "";
            if (!string.IsNullOrWhiteSpace(name)) _memory[name] = value ?? "";
            return StepOutcome.Success;
        }
        if (action is "InsertContent" or "LoadContent")
        {
            var read = _actions.ReadElementValue(_browser.Driver, node, TimeSpan.FromSeconds(15));
            var text = action == "LoadContent" ? (value ?? "") : (read.Value ?? "");
            if (action == "InsertContent" && !read.Ok) return StepOutcome.Fail(read.Error ?? "مقدار از صفحه خوانده نشد.");
            return WriteCell(graph, node, rowIndex, text);
        }

        return await _actions.RunAsync(_browser.Driver, node, value, TimeSpan.FromSeconds(30), ct);
    }

    /// <summary>
    /// Resolve the text a step should use.
    /// </summary>
    /// <remarks>
    /// Mirrors the editor's value-source picker: a constant is used as typed, a source reads the
    /// addressed cell for the current row, and a memory reads what an earlier step stored. Resolving
    /// here — before the action runs — is what lets the action layer stay unaware of where a value
    /// came from.
    /// </remarks>
    private string? ResolveValue(ProcessGraph graph, GraphNode node, int rowIndex)
    {
        var srcType = node.ContentSourceType ?? node.ReadExtraString("valueSourceType");
        var memName = node.MemoryVariableName ?? "";

        if (string.Equals(srcType, "DataSource", StringComparison.OrdinalIgnoreCase))
        {
            var dsId = node.DataSourceId ?? node.SaveDataSourceId;
            var col = node.DynamicSourceColumnName ?? node.SaveColumnName ?? "";
            return ReadCell(graph, dsId, rowIndex, col);
        }
        if (string.Equals(srcType, "Memory", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(memName))
        {
            return _memory.TryGetValue(memName, out var v) ? v : "";
        }
        if (string.Equals(srcType, "SystemDate", StringComparison.OrdinalIgnoreCase))
            return DateTime.Now.ToString("yyyy/MM/dd");
        if (string.Equals(srcType, "SystemTime", StringComparison.OrdinalIgnoreCase))
            return DateTime.Now.ToString("HH:mm:ss");

        return node.ConstantValue ?? node.NavigateUrl ?? "";
    }

    private string ReadCell(ProcessGraph graph, int? dsId, int rowIndex, string columnKey)
    {
        if (dsId is null || dsId <= 0 || string.IsNullOrWhiteSpace(columnKey)) return "";

        if (_localCells.TryGetValue(CellKey(dsId.Value, rowIndex, columnKey), out var cached))
            return cached;

        // A shared source is authoritative on the server even in a local run; a private one is this
        // run's own business, and having no server copy is normal rather than an error.
        var isShared = graph.DataSources.FirstOrDefault(d => d.Id == dsId)?.IsPublic == true;
        if (_allowServerCalls && isShared)
        {
            var remote = _client.ReadCellAsync(dsId.Value, rowIndex, columnKey).GetAwaiter().GetResult();
            if (remote is not null)
            {
                _localCells[CellKey(dsId.Value, rowIndex, columnKey)] = remote;
                return remote;
            }
        }
        return "";
    }

    private StepOutcome WriteCell(ProcessGraph graph, GraphNode node, int rowIndex, string text)
    {
        var dsId = node.SaveDataSourceId ?? node.DataSourceId;
        var col = node.SaveColumnName ?? node.DynamicSourceColumnName;
        if (dsId is null || dsId <= 0 || string.IsNullOrWhiteSpace(col))
        {
            // A step with no source destination is not an error — it simply captured a value the
            // process does not store.
            return StepOutcome.Success;
        }

        var targetRow = node.SpecificRowIndex ?? rowIndex;
        _localCells[CellKey(dsId.Value, targetRow, col)] = text;
        State.Writes.Add(new LocalCellWrite(dsId.Value, targetRow, col, text));
        Log("info", $"نوشتن در منبع #{dsId} ستون «{col}» ردیف {targetRow + 1}");

        var isShared = graph.DataSources.FirstOrDefault(d => d.Id == dsId)?.IsPublic == true;
        if (_allowServerCalls && isShared)
        {
            var ok = _client.PatchCellAsync(dsId.Value, targetRow, col, text).GetAwaiter().GetResult();
            if (!ok) return StepOutcome.Fail("نوشتن در منبع عمومی روی سرور ناموفق بود.");
        }
        return StepOutcome.Success;
    }

    /// <summary>
    /// Evaluate a condition node.
    /// </summary>
    /// <remarks>
    /// The runner supports the condition kinds that are decidable from the values it already holds —
    /// memory and source comparisons. A browser-DOM condition (element exists, text matches) needs
    /// the full selector/matching layer the extension has, and is reported as unsupported rather
    /// than guessed at, because a wrong verdict would send the run down the wrong branch silently.
    /// </remarks>
    private bool EvaluateCondition(ProcessGraph graph, GraphNode node, int rowIndex)
    {
        var condType = node.ReadExtraString("conditionType");
        string? left = null, right = null;

        var subject = node.ReadExtraString("conditionSubject");
        if (string.Equals(subject, "Memory", StringComparison.OrdinalIgnoreCase))
        {
            var name = node.MemoryVariableName ?? "";
            left = _memory.TryGetValue(name, out var v) ? v : "";
        }
        else if (string.Equals(subject, "Source", StringComparison.OrdinalIgnoreCase)
              || string.Equals(subject, "SourceColumnValue", StringComparison.OrdinalIgnoreCase)
              || string.Equals(subject, "SourceValue", StringComparison.OrdinalIgnoreCase))
        {
            var dsId = node.DataSourceId;
            var col = node.DynamicSourceColumnName ?? "";
            left = ReadCell(graph, dsId, rowIndex, col);
        }
        else
        {
            Log("warn", $"شرط «{node.Title ?? node.Id}» از نوع صفحه‌محور است و در اجراکننده محلی ارزیابی نشد؛ نتیجه «ناموفق» فرض شد.");
            return false;
        }

        var operandType = node.ReadExtraString("compareValueSourceType");
        if (string.Equals(operandType, "Memory", StringComparison.OrdinalIgnoreCase))
        {
            var name = node.ReadExtraString("compareMemoryVariableName");
            right = _memory.TryGetValue(name, out var v) ? v : "";
        }
        else
        {
            right = node.ReadExtraString("compareConstantValue");
        }

        var op = node.ReadExtraString("conditionOperator");
        return Compare(left ?? "", right ?? "", op);
    }

    private static bool Compare(string left, string right, string op) => op switch
    {
        "Equals" or "" => string.Equals(left, right, StringComparison.Ordinal),
        "NotEquals" => !string.Equals(left, right, StringComparison.Ordinal),
        "Contains" => left.Contains(right, StringComparison.Ordinal),
        "NotContains" => !left.Contains(right, StringComparison.Ordinal),
        "StartsWith" => left.StartsWith(right, StringComparison.Ordinal),
        "EndsWith" => left.EndsWith(right, StringComparison.Ordinal),
        "GreaterThan" => Num(left) > Num(right),
        "LessThan" => Num(left) < Num(right),
        "GreaterOrEqual" => Num(left) >= Num(right),
        "LessOrEqual" => Num(left) <= Num(right),
        _ => string.Equals(left, right, StringComparison.Ordinal)
    };

    private static double Num(string s)
        => double.TryParse(s, out var d) ? d : 0;

    private static string CellKey(int dsId, int row, string col) => $"{dsId}|{row}|{col.Trim()}";

    private static int ReadTaskId(ProcessGraph graph)
    {
        try
        {
            var raw = graph.TaskIdRaw;
            if (raw.ValueKind == JsonValueKind.Number && raw.TryGetInt32(out var n)) return n;
            if (raw.ValueKind == JsonValueKind.String && int.TryParse(raw.GetString(), out var s)) return s;
        }
        catch { /* a graph with no id simply cannot register a server play */ }
        return 0;
    }

    private void Log(string kind, string text)
    {
        State.Log.Add(new RunLogLine(DateTime.UtcNow, kind, text));
        Changed?.Invoke();
    }
}
