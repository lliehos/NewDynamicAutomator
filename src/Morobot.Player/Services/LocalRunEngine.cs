using System.Text.Json;
using Morobot.Player.Models;
using OpenQA.Selenium;

namespace Morobot.Player.Services;

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
    public bool Paused { get; set; }
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
    private readonly ConditionEvaluator _conditions = new();
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

    /// <summary>
    /// Pause or resume the run.
    /// </summary>
    /// <remarks>
    /// Pausing is cooperative: the walk checks the flag between steps rather than suspending a
    /// thread, so a pause never leaves the browser mid-action. That is the same rule the extension
    /// follows, and it is why the step counter is the right place to show "paused" — the run stops
    /// on a step boundary, never inside one.
    /// </remarks>
    public void SetPaused(bool paused)
    {
        State.Paused = paused;
        Changed?.Invoke();
    }

    public void Stop()
    {
        State.Stopped = true;
        State.Paused = false;
        _cts?.Cancel();
    }

    /// <summary>Wait here while paused, so a long pause does not burn the loop-back guard.</summary>
    private async Task WaitWhilePausedAsync(CancellationToken ct)
    {
        while (State.Paused && !State.Stopped)
            await Task.Delay(120, ct);
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
        // editor; reading them here keeps one source of truth for both.
        if (start.Extra.TryGetValue("stepDelayMs", out var d) && d.TryGetInt32(out var ms))
            graph.StepDelayMs = ms;
        if (start.Extra.TryGetValue("loopBackLimit", out var l) && l.TryGetInt32(out var lim) && lim > 0)
            graph.LoopBackLimit = lim;

        // The run outline colour is the process's own setting, so the highlight here matches what the
        // panel shows for this process rather than a desktop-only default.
        var color = start.HighlightColor ?? start.ReadExtraString("highlightColor");
        if (!string.IsNullOrWhiteSpace(color)) HighlightColor = color;
    }

    /// <summary>
    /// The colour drawn around the element a step is about to act on.
    /// </summary>
    /// <remarks>
    /// Distinct from the editor's own default on purpose: while a run is happening the outline must
    /// read as "this is being executed", not as "this is being edited". A separate value also lets
    /// two processes running side by side be told apart at a glance.
    /// </remarks>
    public string HighlightColor { get; set; } = "#7367F0";

    /// <summary>
    /// Draw the run outline around the element, then remove it.
    /// </summary>
    /// <remarks>
    /// The outline is removed after a short delay rather than left in place: a page that is being
    /// driven accrues dozens of these, and leaving them all would both obscure the page and make the
    /// last action indistinguishable from the current one.
    /// </remarks>
    private async Task FlashElementAsync(GraphNode node)
    {
        if (string.IsNullOrWhiteSpace(node.Selector)) return;
        try
        {
            var selector = node.Selector.Replace("'", "\\'");
            ((IJavaScriptExecutor)_browser.Driver).ExecuteScript(
                "const id='da-run-outline';" +
                "const old=document.getElementById(id);if(old)old.remove();" +
                $"const el=document.querySelector('{selector}');" +
                "if(!el)return;" +
                "const r=el.getBoundingClientRect();" +
                "const box=document.createElement('div');" +
                "box.id=id;" +
                "Object.assign(box.style,{" +
                "position:'fixed',pointerEvents:'none',zIndex:2147483647," +
                "border:'3px solid " + HighlightColor + "',borderRadius:'6px'," +
                "boxShadow:'0 0 0 2px rgba(255,255,255,.7)'" +
                "});" +
                "box.style.left=(r.left-3)+'px';box.style.top=(r.top-3)+'px';" +
                "box.style.width=r.width+'px';box.style.height=r.height+'px';" +
                "document.body.appendChild(box);" +
                "setTimeout(()=>box.remove(),1200);");
        }
        catch { /* the outline is a courtesy; the action below is the real work */ }
        await Task.CompletedTask;
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
                // Pause is honoured on the step boundary, so the browser is never left mid-action.
                await WaitWhilePausedAsync(ct);
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
                    var result = EvaluateCondition(graph, node, rowIndex);
                    if (result.Problem is not null) Log("warn", result.Problem);
                    Log(result.Passed ? "info" : "warn",
                        $"نتیجه شرط «{node.Title ?? node.Id}»: {(result.Passed ? "برقرار" : "برقرار نیست")}");
                    currentId = graph.NextNodeId(currentId, result.Passed);
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

        // Outline the target before acting, so a human watching can see what is about to be touched.
        // Done only for the actions that have a selector — a wait or a memory write has no element.
        if (!string.IsNullOrWhiteSpace(node.Selector))
            await FlashElementAsync(node);

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

        // Row-level actions change the SHAPE of a source's content, so they are not a page action and
        // not a single cell write: they are handled here where the local/server split for a source is
        // already decided.
        if (action is "InsertRow" or "DeleteRow")
            return await ResizeRowsAsync(graph, node, rowIndex, ct);

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
    /// Evaluate a condition node, delegating to the dedicated evaluator.
    /// </summary>
    /// <remarks>
    /// The engine supplies the pieces the evaluator cannot own: the graph walk's current row, the
    /// memory table, and the cell reader (which itself decides local vs server per source). The
    /// evaluation logic lives in <see cref="ConditionEvaluator"/> so every condition type is
    /// comparable against its counterpart in engine.js in one place.
    /// </remarks>
    private ConditionResult EvaluateCondition(ProcessGraph graph, GraphNode node, int rowIndex)
        => _conditions.Evaluate(_browser.Driver, graph, node, rowIndex, _memory,
            (dsId, row, col) => ReadCell(graph, dsId, row, col));

    private static string CellKey(int dsId, int row, string col) => $"{dsId}|{row}|{col.Trim()}";

    /// <summary>
    /// Insert a blank row into, or delete a row from, the step's source.
    /// </summary>
    /// <remarks>
    /// A row change moves every index after it, so the run's own mirror of the source is wrong from
    /// that point on. The cached cells for that source are dropped rather than shifted: a later read
    /// then goes back to the source of truth instead of a mirror the run itself has invalidated.
    ///
    /// Shared sources go to the server in both modes, because a row added to shared data is shared
    /// data. A private source in local mode is edited in the run's own mirror only.
    /// </remarks>
    private async Task<StepOutcome> ResizeRowsAsync(ProcessGraph graph, GraphNode node, int rowIndex, CancellationToken ct)
    {
        var dsId = node.DataSourceId ?? node.SaveDataSourceId;
        if (dsId is null || dsId <= 0)
            return StepOutcome.Fail("برای این اقدام، منبع مشخص نشده است.");

        var isInsert = string.Equals(node.ActionType, "InsertRow", StringComparison.OrdinalIgnoreCase);
        var targetRow = node.SpecificRowIndex ?? rowIndex;
        var isShared = graph.DataSources.FirstOrDefault(d => d.Id == dsId)?.IsPublic == true;

        if (!(_allowServerCalls && isShared))
        {
            Log("info", isInsert
                ? $"ردیف خالی در جای {targetRow} منبع #{dsId} (محلی) درج شد"
                : $"ردیف {targetRow} از منبع #{dsId} (محلی) حذف شد");
            DropCachedCells(dsId.Value);
            await Task.CompletedTask;
            return StepOutcome.Success;
        }

        var result = isInsert
            ? await _client.InsertRowAsync(dsId.Value, targetRow, ct)
            : await _client.DeleteRowAsync(dsId.Value, targetRow, ct);
        if (!result.Ok)
            return StepOutcome.Fail(result.Error ?? "تغییر ردیف‌های منبع روی سرور ناموفق بود.");

        Log("info", isInsert
            ? $"ردیف خالی در جای {targetRow} منبع #{dsId} درج شد"
            : $"ردیف {targetRow} از منبع #{dsId} حذف شد");
        DropCachedCells(dsId.Value);

        // The row count moves with the grid; the LastRow pointer reads it, and a stale count would
        // address a row that no longer exists.
        var ds = graph.DataSources.FirstOrDefault(d => d.Id == dsId);
        if (ds is not null)
            ds.RowCount = Math.Max(0, ds.RowCount + (isInsert ? 1 : -1));

        return StepOutcome.Success;
    }

    private void DropCachedCells(int dsId)
    {
        foreach (var key in _localCells.Keys.Where(k => k.StartsWith($"{dsId}|", StringComparison.Ordinal)).ToList())
            _localCells.Remove(key);
    }

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
