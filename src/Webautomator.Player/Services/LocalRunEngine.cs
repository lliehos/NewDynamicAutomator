using System.Text.Json;
using Webautomator.Player.Models;
using OpenQA.Selenium;

namespace Webautomator.Player.Services;

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

    /// <summary>How many log lines a run keeps; older lines are dropped in blocks by <see cref="AppendLog"/>.</summary>
    public const int LogLimit = 500;

    /// <summary>
    /// Lines ever appended in this run, including the ones <see cref="Log"/> no longer holds.
    /// </summary>
    /// <remarks>
    /// The window uses <c>LogTotal - Log.Count</c> as the number of lines trimmed from the front, so
    /// it can tell "four more lines arrived" from "the front moved" without comparing contents.
    /// </remarks>
    public long LogTotal { get; private set; }

    /// <summary>
    /// Append one line, dropping the oldest block once the list is full.
    /// </summary>
    /// <remarks>
    /// The list used to grow without limit while the run window rebuilt its whole ListBox from it on
    /// every new line, so a long run paid O(n) per line and kept every line it ever wrote in memory.
    /// A loop with a <c>WaitTime</c> in it is the usual way to produce one of those runs. Trimming a
    /// block at a time (not one line per append) keeps memory bounded AND keeps the window's
    /// incremental append valid: the front only moves once per block.
    /// </remarks>
    public void AppendLog(RunLogLine line)
    {
        Log.Add(line);
        LogTotal++;
        if (Log.Count > LogLimit)
            Log.RemoveRange(0, LogLimit / 2);
    }

    /// <summary>Start a fresh log, resetting the counter the window uses to append incrementally.</summary>
    public void ResetLog()
    {
        Log.Clear();
        LogTotal = 0;
    }

    /// <summary>Cells written locally, ready to be pushed by Sync.</summary>
    public List<LocalCellWrite> Writes { get; } = new();
}

public sealed record RunLogLine(DateTime AtUtc, string Kind, string Text);

/// <summary>
/// One cell a local run wrote, ready to be merged by Sync.
/// </summary>
/// <param name="BaseValue">
/// The value the cell held in the copy this run started from. The server compares it with its own
/// current value to tell "nobody else touched this cell" (write the run's value) from a real
/// conflict (keep the server's newer value). <c>null</c> means the run never read the cell, so the
/// server falls back to writing the value as before.
/// </param>
public sealed record LocalCellWrite(int DataSourceId, int RowIndex, string ColumnKey, string? CellValue, string? BaseValue);

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
    private readonly ActionExecutor _actions;
    private readonly RunTabs _tabs = new();
    private readonly ConditionEvaluator _conditions = new();
    private readonly PanelClient _client;
    private readonly FirefoxRunner _browser;
    private readonly bool _allowServerCalls;

    /// <summary>
    /// Values a local run loaded before it started, copied into the run's own mirror.
    /// </summary>
    /// <remarks>
    /// A local run reads non-shared sources from itself, which is only possible if the values are
    /// already here — see <see cref="CanvasCache"/>, which is where this player keeps the copy it
    /// loaded for this revision of the process.
    /// </remarks>
    private readonly List<LocalCellWrite> _seedCells;

    private readonly Dictionary<string, string> _memory = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _localCells = new(StringComparer.Ordinal);

    /// <summary>Resolves dynamic selectors for the graph this run is walking.</summary>
    private SelectorResolver? _selectors;

    /// <summary>
    /// The process-level «چشم‌پوشی از خطای اجرا» switch (start node's <c>ignorePlayError</c>).
    /// </summary>
    /// <remarks>
    /// When on (the default), a step whose own «چشم‌پوشی از خطا» is off does not kill the whole run:
    /// it ends the CURRENT loop index and the next row starts fresh. When off, such a failure stops
    /// the run, which is the author saying "this one must succeed".
    /// </remarks>
    private bool _ignorePlayError = true;

    /// <summary>Steps this run skipped thanks to «چشم‌پوشی از خطا», for the end-of-run note.</summary>
    private int _ignoredErrors;

    /// <summary>Set when the server rejected this client's token during the run.</summary>
    private volatile bool _authRejected;

    /// <summary>Whether the browser (when it IS opened) runs headless.</summary>
    private bool _headless;

    /// <summary>Shown when a run stops because the session behind it is gone.</summary>
    private const string AuthFailureMessage =
        "نشست/دسترسی به سرور معتبر نیست (خطای احراز هویت) — اجرا متوقف شد. " +
        "ورود پنل را تازه کنید و دوباره اجرا کنید.";

    public RunState State { get; } = new();
    public event Action? Changed;

    private CancellationTokenSource? _cts;

    public LocalRunEngine(
        PanelClient client,
        FirefoxRunner browser,
        bool runOnServer,
        IEnumerable<LocalCellWrite>? seedCells = null)
    {
        _client = client;
        _browser = browser;
        _actions = new ActionExecutor(_tabs);
        // A local run must work with no server at all, so its calls are switched off wholesale
        // rather than each being wrapped in a try/catch that would mask a real bug.
        _allowServerCalls = runOnServer;
        _seedCells = seedCells?.ToList() ?? new List<LocalCellWrite>();
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

    /// <summary>
    /// Raised when the server closed this session, so the window can sign out instead of leaving a
    /// signed-out client on screen looking healthy.
    /// </summary>
    public event Action? SessionClosed;

    /// <summary>
    /// Poll the server for a stop instruction while the run is in flight.
    /// </summary>
    /// <remarks>
    /// Runs for local mode too. It never fails the run: an unreachable portal answers "carry on", so a
    /// local run still works with no server at all — but when the portal IS reachable, an
    /// administrator's stop (or a closed session) arrives within a couple of seconds.
    /// </remarks>
    private void StartDirectiveWatch(int taskId, CancellationToken ct)
    {
        if (taskId <= 0) return;

        _ = Task.Run(async () =>
        {
            try
            {
                while (!ct.IsCancellationRequested && State.Running && !State.Stopped)
                {
                    await Task.Delay(TimeSpan.FromSeconds(2), ct);

                    var directive = await _client.GetRunDirectiveAsync(taskId, ct);
                    if (directive == PanelClient.RunDirective.Continue) continue;

                    if (directive == PanelClient.RunDirective.SessionClosed)
                    {
                        Log("error", "دسترسی این حساب توسط مدیر نظارت بسته شد؛ اجرا متوقف شد.");
                        State.LastError = "دسترسی این حساب توسط مدیر نظارت بسته شد.";
                        Stop();
                        Changed?.Invoke();
                        SessionClosed?.Invoke();
                        return;
                    }

                    Log("error", "اجرا توسط مدیر نظارت متوقف شد.");
                    State.LastError = "اجرا توسط مدیر نظارت متوقف شد.";
                    Stop();
                    Changed?.Invoke();
                    return;
                }
            }
            catch (OperationCanceledException) { /* the run ended */ }
            catch { /* a watcher that throws must never fail the run it watches */ }
        }, CancellationToken.None);
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
        State.ResetLog();
        State.Writes.Clear();
        _localCells.Clear();
        _ignoredErrors = 0;
        _authRejected = false;
        _ignorePlayError = graph.StartNode?.ReadExtraBool("ignorePlayError", true) ?? true;
        // A step can discover a dead session BEFORE the 2-second directive poll does (a cell write
        // answers 401 straight away), and that failure must never be swallowed by «چشمپوشی».
        _client.AuthRejected += OnAuthRejected;
        _selectors = new SelectorResolver(
            graph,
            (dsId, row, col) => TryReadCell(graph, dsId, row, col, out var value) ? (true, value) : (false, ""),
            message => Log("error", message));
        if (!State.RunOnServer && _seedCells.Count > 0)
        {
            // Seeded AFTER the clear (which resets the mirror for this run), so a local run starts
            // with the values loaded for this revision instead of an empty mirror.
            foreach (var cell in _seedCells)
                _localCells[CellKey(cell.DataSourceId, cell.RowIndex, cell.ColumnKey)] = cell.CellValue ?? "";
            Log("info", $"مقدار {_seedCells.Count} خانه از منابع محلی از قبل خوانده شد.");
        }
        Log("info", State.RunOnServer ? "شروع اجرا (حالت سرور)" : "شروع اجرا (حالت محلی)");

        var taskId = ReadTaskId(graph);
        var registered = false;
        _headless = headless;
        try
        {
            // The browser is NOT opened here. A Windows run may legitimately never need a page (a
            // process that only reads/writes sources and checks source conditions), and the
            // extension's "tab" only exists because a browser always does. This runner opens
            // Firefox on demand — see EnsureBrowser — so the absence of a browser is normal until
            // the first page-dependent node.
            ApplyStartNodeSettings(graph);

            if (State.RunOnServer && _allowServerCalls && taskId > 0)
            {
                var registration = await _client.RegisterPlayAsync(taskId, ct);
                if (registration == PanelClient.PlayRegistration.Suspended)
                {
                    // The monitoring dashboard stopped server-side runs; starting one anyway would make
                    // the switch a suggestion. Local runs are unaffected by the switch, which is why
                    // this only blocks the server-mode path.
                    Log("error", "اجرای سروری توسط مدیر نظارت متوقف شده است؛ اجرا شروع نشد.");
                    State.LastError = "اجرای سروری توسط مدیر نظارت متوقف شده است.";
                    State.Running = false;
                    return;
                }
                registered = registration == PanelClient.PlayRegistration.Registered;
                if (!registered)
                    Log("warn", "ثبت اجرا روی سرور انجام نشد؛ اجرا ادامه می‌یابد.");
            }
            else if (taskId > 0)
            {
                Log("info", "این اجرا روی سرور ثبت نمی‌شود.");
            }

            // Watch for a stop from the dashboard for BOTH modes: a local run is not registered, but an
            // administrator closing the session still has to reach it, and this is the only channel.
            StartDirectiveWatch(taskId, ct);

            await WalkAsync(graph, rowIndices, ct);
            if (State.Stopped)
                Log("warn", "اجرا توسط کاربر متوقف شد.");
            else if (State.LastError is null)
            {
                // "Successfully finished" must not paper over steps that failed and were skipped:
                // a run whose real work never happened is not a success the operator should trust.
                if (_ignoredErrors > 0)
                    Log("warn",
                        $"اجرا تمام شد — اما {_ignoredErrors} مرحله خطا داشت و طبق تنظیم «چشم‌پوشی از خطا» رد شد. " +
                        "نتیجهٔ کامل حاصل نشده است؛ جزئیات در گزارش بالا.");
                else
                    Log("info", $"اجرا با موفقیت تمام شد ({State.LoopTotal} حلقه).");
            }
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
            _client.AuthRejected -= OnAuthRejected;
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
            // The selector travels as an ARGUMENT, not as interpolated script text: a resolved
            // dynamic selector may contain quotes or backslashes that would otherwise break the
            // script (or, worse, change what it queries).
            ((IJavaScriptExecutor)_browser.Driver).ExecuteScript(
                "const id='da-run-outline';" +
                "const old=document.getElementById(id);if(old)old.remove();" +
                "let el=null;try{el=document.querySelector(arguments[0]);}catch(e){el=null;}" +
                "if(!el)return;" +
                "const r=el.getBoundingClientRect();" +
                "const box=document.createElement('div');" +
                "box.id=id;" +
                "Object.assign(box.style,{" +
                "position:'fixed',pointerEvents:'none',zIndex:2147483647," +
                "border:'3px solid '+arguments[1],borderRadius:'6px'," +
                "boxShadow:'0 0 0 2px rgba(255,255,255,.7)'" +
                "});" +
                "box.style.left=(r.left-3)+'px';box.style.top=(r.top-3)+'px';" +
                "box.style.width=r.width+'px';box.style.height=r.height+'px';" +
                "document.body.appendChild(box);" +
                "setTimeout(()=>box.remove(),1200);",
                node.Selector, HighlightColor);
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
    ///
    /// The row loop also applies the process-level error policy: a non-ignored step failure ends the
    /// CURRENT row and the next one starts fresh while «چشم‌پوشی از خطای اجرا» (the start node's
    /// switch) is on; with that switch off the failure stops the run. An auth failure is never
    /// subjected to either policy — nothing downstream can work against a dead session.
    /// </remarks>
    private async Task WalkAsync(ProcessGraph graph, IReadOnlyList<int> rowIndices, CancellationToken ct)
    {
        var rows = rowIndices.Count > 0 ? rowIndices : new List<int> { 0 };
        State.LoopTotal = rows.Count;

        var start = graph.StartNode;
        if (start is null)
        {
            State.LastError = "نود شروع در فرآیند پیدا نشد.";
            Log("error", State.LastError);
            return;
        }

        for (var li = 0; li < rows.Count; li++)
        {
            ct.ThrowIfCancellationRequested();
            if (State.Stopped) return;
            State.LoopIndex = li + 1;
            var rowIndex = rows[li];
            Log("info", $"──── حلقه {li + 1} / {rows.Count} (ردیف {rowIndex + 1}) ────");
            Changed?.Invoke();

            var walked = await WalkGraphAsync(graph, start.Id, rowIndex, li + 1, ct);
            if (walked.StopRun) return;

            if (walked.StepFailed)
            {
                if (walked.AuthFailure || _authRejected)
                {
                    // Never ignored: «چشم‌پوشی» exists for a flaky step, not for "the session is gone".
                    State.LastError = AuthFailureMessage;
                    Log("error", $"توقف اجرا — {AuthFailureMessage}");
                    return;
                }
                if (_ignorePlayError)
                {
                    Log("warn",
                        $"چشم‌پوشی از خطای اجرا (نود شروع روشن) — ادامه اندیس بعدی حلقه: {walked.Error}");
                    continue;
                }
                State.LastError = walked.Error ?? "خطای اجرا";
                Log("error", $"توقف اجرا — چشم‌پوشی از خطای اجرا (نود شروع) خاموش: {State.LastError}");
                return;
            }
        }
    }

    /// <summary>One nesting level of the walk (the process level, or one iteration of a group).</summary>
    private sealed class WalkFrame
    {
        public string? Cur;

        /// <summary>
        /// Node visit counts of THIS loop instance.
        /// </summary>
        /// <remarks>
        /// Per level, not per walk: the budget on a condition answers "how many rounds may THIS loop
        /// take", and a group that repeats must give each of its iterations a fresh count.
        /// </remarks>
        public readonly Dictionary<string, int> Visits = new(StringComparer.Ordinal);

        /// <summary>The row of this level (a group rebinds it to its own repeat row).</summary>
        public int Row;

        /// <summary>The process loop's row — never rebound by a group, so "process row" works at depth.</summary>
        public int OuterRow;

        /// <summary>0-based combined position (process × groups), used by the selector's «کل حلقه‌ها».</summary>
        public int OrdinalBase;

        // Remaining group iterations at this level; null means a plain (non-group) level.
        public List<int>? PendingGroupRows;
        public int PendingGroupIndex;
        public int PendingGroupTotal;
        public bool MoveLoop = true;
        public GraphNode? GroupStart;
        public string? GroupNodeId;
        public string? EntryId;
    }

    /// <summary>How one row's walk ended.</summary>
    private sealed record WalkOutcome(
        bool StopRun = false, bool StepFailed = false, string? Error = null, bool AuthFailure = false);

    /// <summary>Groups may nest this deep before the walk decides the diagram is cyclic.</summary>
    private const int MaxGroupDepth = 50;

    /// <summary>Total node visits in ONE row's walk — a backstop against a cyclic diagram.</summary>
    private const int WalkStepGuard = 100_000;

    /// <summary>
    /// Open the run's browser when the node about to run needs a page.
    /// </summary>
    /// <remarks>
    /// The extension always has a browser, so a page action never has to think about whether one
    /// exists. In the Windows player the browser IS the tab, and a process may never need one at
    /// all — so it is created at the first node that does, and a failure to create it is reported
    /// as that node's error instead of being buried in a driver exception.
    /// </remarks>
    private StepOutcome? EnsureBrowser(string label)
    {
        if (_browser.IsOpen) return null;
        try
        {
            _browser.Start(_headless);
            // The window the browser opened in is the run's `main` tab: every SwitchTab default and
            // CloseTab-by-alias resolves against it, exactly as the editor describes it.
            _tabs.Reset();
            _tabs.Register("main", _browser.Driver.CurrentWindowHandle);
            Log("info", $"مرورگر برای «{label}» باز شد.");
            return null;
        }
        catch (Exception ex)
        {
            return StepOutcome.Fail($"باز کردن مرورگر ناموفق بود: {ex.Message}");
        }
    }

    /// <summary>Whether a node needs the run's page (mirrors <c>nodeNeedsBrowserTab</c>).</summary>
    private static bool NodeNeedsBrowser(GraphNode node)
    {
        if (node.IsCondition)
        {
            var ct = node.ReadExtraString("conditionType");
            // Page-dependent conditions always need it; these never do; the rest only when their
            // compare operand is read from a page element.
            if (ct == "Url") return true;
            if (ct is "FindElement" or "NotFindElement" or "FindElements"
                or "ElementValue" or "ElementVisible" or "ElementHidden") return true;
            if (ct is "DriverTabs" or "SystemDate" or "SystemTime" or "MemoryValue") return false;
            return string.Equals(node.ContentSourceType ?? "Constant", "Elements", StringComparison.OrdinalIgnoreCase);
        }

        if (node.IsStart)
        {
            // A repeat driven by page elements reads its iterations from the page.
            return string.Equals(node.ReadExtraString("repeatSourceType"), "Elements", StringComparison.OrdinalIgnoreCase);
        }

        if (!node.IsAction) return false;
        var action = node.ActionType ?? "";
        // GoToUrl is the step that CREATES the page here, so it needs the browser even though the
        // extension marks it as "not browser-dependent" (there, it only needs the worker).
        if (action == "GoToUrl") return true;
        if (action == "LoadContent")
        {
            var target = node.SaveTargetType ?? node.ReadExtraString("loadTargetType");
            return !string.Equals(target, "Memory", StringComparison.OrdinalIgnoreCase);
        }
        if (BrowserActions.Contains(action)) return true;

        var source = node.ContentSourceType ?? "";
        if (string.Equals(source, "Elements", StringComparison.OrdinalIgnoreCase)
            && ElementValueActions.Contains(action)) return true;
        if (string.Equals(source, "PageUrl", StringComparison.OrdinalIgnoreCase)
            && action == "InsertContent") return true;
        return false;
    }

    /// <summary>Actions that act on the page of the run's browser (engine.js <c>spec.browser</c>).</summary>
    private static readonly HashSet<string> BrowserActions = new(StringComparer.Ordinal)
    {
        "Click", "DoubleClick", "RightClick", "Hover", "Hold", "ClearContent", "SelectOption",
        "InputContent", "GoBack", "GoForward", "Refresh", "ScrollPage", "CloseTab",
        "SwitchTab", "PressKey", "WaitForLoading", "RemoveElements", "AlertAccept"
    };

    /// <summary>Actions that MAY read their value from a page element (<c>spec.elementVal</c>).</summary>
    private static readonly HashSet<string> ElementValueActions = new(StringComparer.Ordinal)
    {
        "SelectOption", "InputContent", "InsertContent", "SetMemory"
    };

    /// <summary>
    /// Walk the flow diagram from <paramref name="entryId"/> with an explicit frame stack.
    /// </summary>
    /// <remarks>
    /// Port of <c>executeFlow</c> in engine.js: start → next, action → next, condition →
    /// success|fail, group → its entry for each repeat row, then the group's outgoing edge. Frames
    /// are heap data rather than recursion, so a deeply nested — or accidentally cyclic — diagram
    /// cannot blow the stack.
    /// </remarks>
    private async Task<WalkOutcome> WalkGraphAsync(
        ProcessGraph graph, string entryId, int rowIndex, int loopIndex, CancellationToken ct)
    {
        var edges = graph.Edges;
        var limits = ResolveLoopBackLimits(graph);
        var stack = new List<WalkFrame>
        {
            new() { Cur = entryId, Row = rowIndex, OuterRow = rowIndex, OrdinalBase = Math.Max(0, loopIndex - 1) }
        };
        var guard = 0;

        while (stack.Count > 0 && !State.Stopped && State.LastError is null && guard++ < WalkStepGuard)
        {
            ct.ThrowIfCancellationRequested();
            // Pause is honoured on the step boundary, so the browser is never left mid-action.
            await WaitWhilePausedAsync(ct);
            if (State.Stopped) return new WalkOutcome(StopRun: true);
            if (_authRejected) return new WalkOutcome(StepFailed: true, AuthFailure: true);

            var frame = stack[^1];

            // --- a group level that still has iterations to run ---------------------------------
            if (frame.PendingGroupRows is { } pending && frame.Cur is null)
            {
                if (frame.PendingGroupIndex >= pending.Count)
                {
                    // Iterations exhausted: continue on the edge AFTER the group, at every level.
                    var afterId = FlowEdge(edges, frame.GroupNodeId, "next")?.To;
                    frame.PendingGroupRows = null;
                    frame.PendingGroupIndex = 0;
                    frame.PendingGroupTotal = 0;
                    frame.MoveLoop = true;
                    frame.GroupStart = null;
                    frame.GroupNodeId = null;
                    frame.Cur = afterId;
                    if (string.IsNullOrEmpty(afterId)) continue;
                    await DelayAfterNodeAsync(graph, afterId, ct);
                    continue;
                }

                var gi = frame.PendingGroupIndex++;
                var groupRow = pending[gi];
                var parentRow = frame.Row;
                // «حرکت حلقه» off means the group's row does NOT become the row the body works on.
                var effectiveRow = frame.MoveLoop ? groupRow : parentRow;
                if (frame.PendingGroupTotal > 1)
                    Log("info",
                        $"تکرار گروه «{frame.GroupStart?.Title ?? frame.GroupNodeId}» " +
                        $"{gi + 1}/{frame.PendingGroupTotal} ({frame.GroupStart?.ReadExtraString("repeatSourceType")})");

                stack.Add(new WalkFrame
                {
                    Cur = frame.EntryId,
                    Row = effectiveRow,
                    OuterRow = frame.OuterRow,
                    // The combined position multiplies into the parent's; the iteration's ORDINAL is
                    // used, not its row value (a group repeating rows 5..7 still counts 1,2,3).
                    OrdinalBase = frame.OrdinalBase * Math.Max(1, frame.PendingGroupTotal) + gi
                });
                continue;
            }

            var cur = frame.Cur;
            if (string.IsNullOrEmpty(cur))
            {
                stack.RemoveAt(stack.Count - 1);
                continue;
            }

            var node = graph.NodeById(cur);
            if (node is null)
            {
                stack.RemoveAt(stack.Count - 1);
                continue;
            }

            var loopLimit = LoopBackLimitFor(node, limits);
            frame.Visits.TryGetValue(cur, out var hits);
            var visits = hits + 1;
            frame.Visits[cur] = visits;
            if (visits > loopLimit)
            {
                var label = node.Title ?? node.Id;
                Log("error",
                    $"«{label}» بیش از {loopLimit} بار اجرا شد و شرط خروج آن برقرار نشد — اجرا متوقف شد. " +
                    "(سقف تکرار را از نود شرط → «حداکثر بازگشت حلقه» تغییر دهید)");
                State.LastError = $"حداکثر بازگشت حلقه در نود «{label}» رد شد";
                return new WalkOutcome(StopRun: true);
            }

            var rowCtx = new RowScope(
                GroupRow: frame.Row,
                ParentRow: stack.Count >= 2 ? stack[^2].Row : frame.Row,
                ProcessRow: frame.OuterRow,
                LoopIndex: loopIndex,
                CombinedIndex: frame.OrdinalBase);

            if (node.IsEnd)
            {
                // Terminal marker: the author said this path stops here — ends as a SUCCESS.
                Log("info", $"نود «پایان» — مسیر در «{node.Title ?? "پایان"}» خاتمه یافت.");
                frame.Cur = null;
                continue;
            }

            if (node.IsStart)
            {
                // No delay after start — the first step runs immediately.
                frame.Cur = FlowEdge(edges, cur, "next")?.To;
                continue;
            }

            if (node.IsAction)
            {
                if (node.IsActive == false)
                {
                    Log("info", $"نود غیرفعال رد شد: {node.Title ?? node.Id}");
                    frame.Cur = FlowEdge(edges, cur, "next")?.To;
                    continue;
                }

                var nodeRow = ResolveRowPointer(graph, node, rowCtx, selectorSide: false) ?? rowCtx.ProcessRow;
                var selectorRow = ResolveRowPointer(graph, node, rowCtx, selectorSide: true);
                var outcome = await RunActionAsync(graph, node, nodeRow, selectorRow, rowCtx, ct);
                if (!outcome.Ok)
                {
                    var title = node.Title ?? node.Id;
                    // «چشم‌پوشی از خطا» is on by default for a step: a flaky step must not end a long
                    // run, it only marks that step and the walk continues along the diagram.
                    if (node.ReadExtraBool("ignoreError", true) && !_authRejected)
                    {
                        _ignoredErrors++;
                        Log("warn", $"چشم‌پوشی از خطای مرحله «{title}»: {outcome.Error}");
                        // Falls through to the normal edge walk below.
                    }
                    else
                    {
                        Log("error", $"خطا در «{title}»: {outcome.Error}");
                        return new WalkOutcome(StepFailed: true, Error: outcome.Error, AuthFailure: _authRejected);
                    }
                }

                var nextId = FlowEdge(edges, cur, "next")?.To;
                await DelayAfterNodeAsync(graph, nextId, ct);
                frame.Cur = nextId;
                continue;
            }

            if (node.IsCondition)
            {
                // A page-dependent condition is where a tab-less run REALISES it needs a browser.
                // Failing to open one stops the run: answering "false" would silently take the
                // fail branch for a page that was never looked at.
                if (NodeNeedsBrowser(node))
                {
                    var open = EnsureBrowser(node.Title ?? node.Id);
                    if (open is not null)
                    {
                        State.LastError = open.Error;
                        Log("error", $"توقف اجرا — {open.Error}");
                        return new WalkOutcome(StopRun: true);
                    }
                }

                var condRow = ResolveRowPointer(graph, node, rowCtx, selectorSide: false) ?? rowCtx.ProcessRow;
                var condSelectorRow = ResolveRowPointer(graph, node, rowCtx, selectorSide: true);
                var result = EvaluateCondition(graph, node, condRow, condSelectorRow, rowCtx);
                if (result.Problem is not null) Log("warn", result.Problem);
                Log(result.Passed ? "info" : "warn",
                    $"نتیجه شرط «{node.Title ?? node.Id}»: {(result.Passed ? "برقرار" : "برقرار نیست")}");

                // A condition has two logical branches and each must be wired. A plain `next` edge is
                // only honoured when the node has no success/fail edges at all.
                var hasBranchEdges = edges.Any(e => string.Equals(e.From, cur, StringComparison.Ordinal)
                    && (string.Equals(e.Kind, "success", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(e.Kind, "fail", StringComparison.OrdinalIgnoreCase)));
                var wanted = result.Passed ? "success" : "fail";
                var edge = hasBranchEdges ? FlowEdge(edges, cur, wanted) : FlowEdge(edges, cur, "next");

                if (edge is null && hasBranchEdges)
                {
                    // An unwired branch is only an error when the graph has no terminal marker: with
                    // an «پایان» node the author has declared that paths may stop.
                    if (graph.Nodes.Any(n => n.IsEnd))
                    {
                        Log("info",
                            $"شرط «{node.Title ?? node.Id}»: نتیجهٔ {(result.Passed ? "موفق" : "ناموفق")} شد و " +
                            $"شاخهٔ «{(result.Passed ? "موفق" : "ناموفق")}» وصل نیست — مسیر خاتمه یافت.");
                        frame.Cur = null;
                        continue;
                    }
                }
                if (edge is null)
                {
                    State.LastError = hasBranchEdges
                        ? $"شاخهٔ «{wanted}» برای شرط «{node.Title ?? node.Id}» وصل نشده است."
                        : $"شرط «{node.Title ?? node.Id}» شاخهٔ خروجی ندارد.";
                    Log("error", State.LastError);
                    return new WalkOutcome(StopRun: true);
                }

                await DelayAfterNodeAsync(graph, edge.To, ct);
                frame.Cur = edge.To;
                continue;
            }

            if (node.IsGroup)
            {
                if (stack.Count > MaxGroupDepth)
                {
                    var label = node.Title ?? node.Id;
                    Log("error",
                        $"عمق تودرتویی گروه‌ها از {MaxGroupDepth} گذشت (گروه «{label}») — احتمالاً گروه‌ها " +
                        "به هم بازمی‌گردند. اجرا متوقف شد.");
                    State.LastError = $"عمق تودرتویی گروه‌ها بیش از حد مجاز است (گروه «{label}»)";
                    return new WalkOutcome(StopRun: true);
                }

                Log("info", $"ورود به گروه «{node.Title ?? node.Id}»");
                var innerStart = graph.Nodes.FirstOrDefault(n => n.IsStart && n.GroupNodeId == node.Id)
                    ?? (FlowEdge(edges, node.Id, "contains") is { } contains ? graph.NodeById(contains.To) : null)
                    ?? FindGroupEntryFallback(graph, node.Id);
                if (innerStart is null)
                {
                    Log("warn", $"گروه «{node.Title ?? node.Id}» ورودی ندارد");
                    var afterId = FlowEdge(edges, node.Id, "next")?.To;
                    await DelayAfterNodeAsync(graph, afterId, ct);
                    frame.Cur = afterId;
                    continue;
                }

                var groupStart = graph.Nodes.FirstOrDefault(n => n.IsStart && n.GroupNodeId == node.Id) ?? innerStart;
                // A repeat over page ELEMENTS has to count them on the page, so it needs a browser
                // just as much as a Click does.
                if (NodeNeedsBrowser(groupStart) || NodeNeedsBrowser(node))
                {
                    var open = EnsureBrowser(node.Title ?? node.Id);
                    if (open is not null)
                    {
                        State.LastError = open.Error;
                        Log("error", $"توقف اجرا — {open.Error}");
                        return new WalkOutcome(StopRun: true);
                    }
                }
                var iterations = await ExpandGroupIterationsAsync(graph, groupStart, rowCtx, rowCtx.ProcessRow, ct);

                frame.Cur = null;
                frame.PendingGroupRows = iterations;
                frame.PendingGroupIndex = 0;
                frame.PendingGroupTotal = iterations.Count;
                // «حرکت حلقه» is off when EITHER the group or its start says so.
                frame.MoveLoop = groupStart.ReadExtraBool("moveLoop", true) && node.ReadExtraBool("moveLoop", true);
                frame.GroupStart = groupStart;
                frame.GroupNodeId = node.Id;
                frame.EntryId = innerStart.Id;
                continue;
            }

            Log("warn", $"نود ناشناخته: {node.Kind} ({node.Id})");
            return new WalkOutcome(StopRun: true);
        }

        // The walk ran out of its own ceiling instead of finishing: that is a cyclic diagram.
        if (!State.Stopped && State.LastError is null && guard >= WalkStepGuard)
        {
            State.LastError = $"سقف {WalkStepGuard} مرحله در یک دور اجرا رد شد — احتمالاً حلقه‌ای بسته نمی‌شود.";
            Log("error", State.LastError);
            return new WalkOutcome(StopRun: true);
        }

        return new WalkOutcome();
    }

    // ---- Flow helpers ---------------------------------------------------------------------------

    /// <summary>The first outgoing edge of the given kinds that does not point back at its own node.</summary>
    private static GraphEdge? FlowEdge(IEnumerable<GraphEdge> edges, string? fromId, params string[] kinds)
    {
        if (string.IsNullOrEmpty(fromId)) return null;
        foreach (var kind in kinds)
        {
            var edge = edges.FirstOrDefault(e =>
                string.Equals(e.From, fromId, StringComparison.Ordinal)
                && string.Equals(e.Kind, kind, StringComparison.OrdinalIgnoreCase)
                && !string.Equals(e.To, fromId, StringComparison.Ordinal));
            if (edge is not null) return edge;
        }
        return null;
    }

    /// <summary>The loop-back budgets: a condition's own value, or the process-wide fallback.</summary>
    private static (int DefaultLimit, int MaxLimit) ResolveLoopBackLimits(ProcessGraph graph)
    {
        static int Clamp(int? value, int fallback)
        {
            var fb = fallback > 0 ? Math.Max(1, fallback) : 100;
            return value is int v && v > 0 ? Math.Max(1, v) : fb;
        }

        var legacy = Clamp(graph.LoopBackLimit, 100);
        var max = legacy;
        foreach (var node in graph.Nodes.Where(n => n.IsCondition))
        {
            var v = Clamp(node.ReadExtraInt("loopBackLimit"), legacy);
            if (v > max) max = v;
        }
        return (legacy, max);
    }

    /// <summary>The visit budget a node gets in one loop instance.</summary>
    private static int LoopBackLimitFor(GraphNode node, (int DefaultLimit, int MaxLimit) limits)
    {
        if (!node.IsCondition) return limits.MaxLimit;
        var own = node.ReadExtraInt("loopBackLimit");
        return own is int v && v > 0 ? Math.Max(1, v) : limits.DefaultLimit;
    }

    /// <summary>The gap after a finished node, and only when something follows it.</summary>
    private static async Task DelayAfterNodeAsync(ProcessGraph graph, string? nextId, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(nextId) || graph.StepDelayMs <= 0) return;
        await Task.Delay(graph.StepDelayMs, ct);
    }

    /// <summary>
    /// The entry node of a group that has no start node and no `contains` edge.
    /// </summary>
    /// <remarks>
    /// The child nothing else points at is the entry; otherwise the first child. Mirrors
    /// <c>findGroupEntryFallback</c> — a group saved before the entry edge existed still runs.
    /// </remarks>
    private static GraphNode? FindGroupEntryFallback(ProcessGraph graph, string groupId)
    {
        var kids = graph.Nodes
            .Where(n => string.Equals(n.GroupNodeId, groupId, StringComparison.Ordinal)
                        && (n.IsAction || n.IsCondition || n.IsGroup))
            .ToList();
        if (kids.Count == 0) return null;
        var kidIds = kids.Select(k => k.Id).ToHashSet(StringComparer.Ordinal);
        var targeted = graph.Edges
            .Where(e => kidIds.Contains(e.To)
                        && (string.Equals(e.Kind, "next", StringComparison.OrdinalIgnoreCase)
                            || string.Equals(e.Kind, "success", StringComparison.OrdinalIgnoreCase)
                            || string.Equals(e.Kind, "fail", StringComparison.OrdinalIgnoreCase)))
            .Select(e => e.To)
            .ToHashSet(StringComparer.Ordinal);
        return kids.FirstOrDefault(k => !targeted.Contains(k.Id)) ?? kids[0];
    }

    // ---- Row pointers ---------------------------------------------------------------------------

    /// <summary>
    /// The row a node's own (or its selector's) pointer names, or null when it names none.
    /// </summary>
    /// <remarks>
    /// Port of <c>resolveRowPointer</c>. The pointer lives on the node that reads or writes a source
    /// row, because that is where "which row?" is a real question: one process may read row 0 for a
    /// lookup and write the loop's row for its result. This runner keeps its numbers exactly as
    /// engine.js does — including <c>TotalLoop</c> handing back the 1-based run ordinal.
    /// </remarks>
    private static int? ResolveRowPointer(ProcessGraph graph, GraphNode node, RowScope scope, bool selectorSide)
    {
        var pointer = selectorSide ? node.ReadExtraString("selectorRowIndexType") : node.RowIndexType ?? "";
        if (pointer.Length == 0) pointer = "None";

        return pointer switch
        {
            "CurrentLoop" => scope.GroupRow,
            "ParentLoop" => scope.ParentRow,
            "GroupLoop" => scope.GroupRow,
            "ProcessLoop" => scope.ProcessRow,
            "TotalLoop" => scope.LoopIndex,
            "FirstRow" => 0,
            "LastRow" => LastPointerRow(graph, node),
            "SpecificRow" => SpecificPointerRow(graph, node, selectorSide),
            _ => null
        };
    }

    private static int? SpecificPointerRow(ProcessGraph graph, GraphNode node, bool selectorSide)
    {
        var index = selectorSide
            ? node.ReadExtraInt("selectorSpecificRowIndex")
            : node.SpecificRowIndex ?? node.ReadExtraInt("specificRowIndex");
        if (index is not int idx || idx < 0) return null;
        // Clamp to the source so a stale index (the source shrank after saving) reads the nearest
        // existing row instead of nothing.
        var ds = PointerSource(graph, node);
        return ds is not null && ds.RowCount > 0 && idx > ds.RowCount - 1 ? ds.RowCount - 1 : idx;
    }

    private static int? LastPointerRow(ProcessGraph graph, GraphNode node)
    {
        var ds = PointerSource(graph, node);
        return ds is not null && ds.RowCount > 0 ? ds.RowCount - 1 : null;
    }

    /// <summary>The source a row pointer resolves against (the node's own pick).</summary>
    private static GraphDataSource? PointerSource(ProcessGraph graph, GraphNode node)
    {
        // A condition's SUBJECT is `sourceId`; `dataSourceId` there belongs to the COMPARE operand.
        var id = node.IsCondition && SubjectIsSource(node)
            ? node.SourceId ?? node.DataSourceId
            : node.DataSourceId ?? node.SaveDataSourceId ?? node.SourceId;
        if (id is not int wanted) return null;
        return graph.DataSources.FirstOrDefault(d => d.Id == wanted);
    }

    private static bool SubjectIsSource(GraphNode node)
        => node.ReadExtraString("conditionType") is "SourceValue" or "SourceColumnValue" or "SourceRowValue";

    // ---- Group repeat ---------------------------------------------------------------------------

    /// <summary>Expand a group's repeat settings into the row indices its body runs for.</summary>
    private async Task<List<int>> ExpandGroupIterationsAsync(
        ProcessGraph graph, GraphNode node, RowScope scope, int fallbackRow, CancellationToken ct)
    {
        var kind = node.ReadExtraString("repeatSourceType");
        if (kind.Length == 0 || string.Equals(kind, "None", StringComparison.OrdinalIgnoreCase))
            return new List<int> { 0 };

        if (string.Equals(kind, "Loops", StringComparison.OrdinalIgnoreCase))
        {
            var count = node.ReadExtraInt("loopCount") ?? 0;
            if (count <= 0 && int.TryParse(node.ConstantValue, out var fromConstant)) count = fromConstant;
            count = Math.Max(1, count);
            return Enumerable.Range(0, count).ToList();
        }

        if (string.Equals(kind, "DataSource", StringComparison.OrdinalIgnoreCase))
        {
            var source = graph.DataSources.FirstOrDefault(d => d.Id == node.DataSourceId);
            var count = source?.RowCount ?? 0;
            if (count <= 0)
            {
                Log("warn", "منبع گروه ردیفی ندارد؛ یک‌بار اجرا می‌شود.");
                return new List<int> { 0 };
            }
            // The group start has its own from/to range, exactly like the process start.
            return ApplyIndexRange(
                Enumerable.Range(0, count).ToList(),
                node.ReadExtraInt("repeatFromIndex"),
                node.ReadExtraInt("repeatToIndex"));
        }

        if (string.Equals(kind, "Elements", StringComparison.OrdinalIgnoreCase))
        {
            var css = node.ReadExtraString("elementValue");
            if (css.Length == 0) css = node.SelectorValue ?? "";
            if (node.ReadExtraBool("selectorIsDynamic", false) || node.ReadExtraBool("attributeValueIsDynamic", false))
            {
                try
                {
                    var selRow = ResolveRowPointer(graph, node, scope, selectorSide: true);
                    css = _selectors?.ResolveTarget(node, selRow ?? fallbackRow, scope) ?? css;
                }
                catch (Exception ex)
                {
                    Log("warn", $"ساخت سلکتور پویا برای تکرار گروه ناموفق: {ex.Message}");
                }
            }
            if (css.Length == 0)
            {
                Log("warn", "سلکتور تکرار المان خالی است؛ یک‌بار اجرا می‌شود.");
                return new List<int> { 0 };
            }

            // The count honours the same wait switch as any selector: a list that appears late must
            // not be read as "no elements".
            var budgetMs = WaitBudgetMs(node, equal: false);
            var deadline = DateTime.UtcNow.AddMilliseconds(budgetMs);
            var count = 0;
            while (true)
            {
                try
                {
                    using var frame = FrameNavigator.Enter(_browser.Driver, node);
                    count = _browser.Driver.FindElements(By.CssSelector(css)).Count;
                }
                catch { count = 0; }

                if (count > 0 || budgetMs <= 0 || DateTime.UtcNow >= deadline) break;
                await Task.Delay(200, ct);
            }
            if (count <= 0)
            {
                Log("warn", "هیچ المانی برای تکرار گروه پیدا نشد؛ یک‌بار اجرا می‌شود.");
                return new List<int> { 0 };
            }
            return Enumerable.Range(0, count).ToList();
        }

        return new List<int> { 0 };
    }

    /// <summary>Apply a 1-based from/to range, tolerating a reversed or out-of-range pair.</summary>
    private static List<int> ApplyIndexRange(List<int> indices, int? fromRaw, int? toRaw)
    {
        var total = indices.Count;
        if (total == 0) return indices;

        int? OneBased(int? raw) => raw is int n && n >= 1 ? n : null;
        var from = OneBased(fromRaw);
        var to = OneBased(toRaw);
        if (from is null && to is null) return indices;

        from ??= 1;
        to ??= total;
        if (from > to) (from, to) = (to, from);   // a reversed range is a typo, not "run nothing"

        var start = Math.Max(1, from.Value);
        var end = Math.Min(total, to.Value);
        if (start > end) return indices;
        return indices.GetRange(start - 1, end - start + 1);
    }

    private async Task<StepOutcome> RunActionAsync(
        ProcessGraph graph, GraphNode node, int nodeRow, int? selectorRow, RowScope scope, CancellationToken ct)
    {
        State.StepIndex++;
        if (State.StepIndex > State.StepTotal) State.StepTotal = State.StepIndex;
        Changed?.Invoke();
        var label = node.Title ?? node.ActionType ?? node.Id;
        Log("info", $"اجرای «{label}»");

        // The browser is created HERE, at the first step that actually needs a page. A Windows run
        // may never need one at all, and a run that starts with a tab-less check must not open a
        // window it does not use.
        if (NodeNeedsBrowser(node))
        {
            var open = EnsureBrowser(label);
            if (open is not null) return open;
        }

        // The selector is a TEMPLATE until the run resolves it: a dynamic selector is built from the
        // current row, which is why this happens per execution rather than once per graph.
        try
        {
            _selectors?.ResolveNode(node, nodeRow, selectorRow, scope);
        }
        catch (Exception ex)
        {
            return StepOutcome.Fail(ex.Message);
        }

        var action = node.ActionType ?? "";
        // LoadContent's value always comes from a source CELL — its own source and column, not the
        // generic value-source picker — and is then put INTO the page (or a memory variable).
        // A failed read is a step ERROR: typing "" into a real form looks like success.
        string? value;
        if (action is "LoadContent")
        {
            var dsId = node.DataSourceId ?? node.SaveDataSourceId;
            var column = node.DynamicSourceColumnName ?? node.SaveColumnName ?? "";
            if (!TryReadCell(graph, dsId, nodeRow, column, out var cellValue))
                return StepOutcome.Fail(
                    $"مقدار از منبع داده خوانده نشد (منبع {dsId?.ToString() ?? "?"}، ستون «{column}»).");
            value = cellValue;
        }
        else
        {
            value = ResolveValue(graph, node, nodeRow);
        }

        // A blank Hold duration is not an error: it falls back to the diagram's inter-step gap (or
        // a short perceptible press when there is none), so the step still means something.
        if (action is "Hold" && string.IsNullOrWhiteSpace(value))
            value = (graph.StepDelayMs > 0 ? graph.StepDelayMs : 500).ToString();

        // The wait switch is a BUDGET on "resolve the frame chain + find the element", not a sleep:
        // each attempt re-enters the frames and performs ONE lookup, and only a MISS is retried, so
        // an action that actually ran can never be dispatched twice.
        var deadline = DateTime.UtcNow.AddMilliseconds(ActionWaitBudgetMs(node, action));
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            StepOutcome outcome;
            try
            {
                // Everything a step does happens inside its recorded frame chain (when it has one),
                // and the driver is returned to the top document afterwards.
                using var frame = FrameNavigator.Enter(_browser.Driver, node);
                outcome = await RunInsideFrameAsync(graph, node, nodeRow, value, action, ct);
            }
            catch (FrameNotResolvedException ex)
            {
                outcome = StepOutcome.Fail(ex.Message, retryable: true);
            }
            catch (Exception ex)
            {
                return StepOutcome.Fail(ex.Message);
            }

            if (outcome.Ok || !outcome.Retryable || DateTime.UtcNow >= deadline) return outcome;
            await Task.Delay(200, ct);
        }
    }

    /// <summary>Run one action inside the node's frame scope; the caller owns frame entry and retries.</summary>
    private async Task<StepOutcome> RunInsideFrameAsync(
        ProcessGraph graph, GraphNode node, int rowIndex, string? value, string action, CancellationToken ct)
    {
        // «عنصر صفحه» is a value SOURCE like any other, and it has to be read from the page the
        // action is about to touch — inside the frame chain, not before entering it. InsertContent
        // is the exception: it reads the value-side element to write it into a SOURCE, so its read
        // happens in its own branch below.
        if (action is not "InsertContent" && IsElementsValueSource(node))
        {
            var read = _actions.ReadElementValue(_browser.Driver, node);
            if (!read.Ok) return read;
            value = read.Value ?? "";
        }

        // Outline the target before acting, so a human watching can see what is about to be touched.
        // Done only for the actions that have a selector — a wait or a memory write has no element.
        if (!string.IsNullOrWhiteSpace(node.Selector))
            await FlashElementAsync(node);

        // Actions that only write into a source never touch the page.
        if (action is "SetMemory")
        {
            var name = node.MemoryVariableName ?? "";
            if (!string.IsNullOrWhiteSpace(name)) _memory[name] = value ?? "";
            return StepOutcome.Success;
        }
        if (action is "InsertContent")
        {
            // The value source decides where the value comes from, exactly as the editor's picker
            // says. «عنصر صفحه» reads the page; constant / memory / system / page-URL were already
            // resolved above. This mirrors the extension's resolveStepParamAsync, which used to be
            // diverged here: every InsertContent read the page regardless of the chosen source.
            var source = node.ContentSourceType ?? node.ReadExtraString("valueSourceType");
            if (string.Equals(source, "Elements", StringComparison.OrdinalIgnoreCase))
            {
                var read = _actions.ReadElementValue(_browser.Driver, node);
                if (!read.Ok) return read;
                return WriteCell(graph, node, rowIndex, read.Value ?? "");
            }
            return WriteCell(graph, node, rowIndex, value ?? "");
        }
        if (action is "LoadContent")
        {
            // «بارگذاری از منبع در المان»: where the cell's value lands is the author's choice — a
            // page element, or a run-memory variable. Writing it back into a source (what this
            // runner used to do) was the opposite direction of the action's name.
            var target = node.SaveTargetType ?? node.ReadExtraString("loadTargetType");
            if (string.Equals(target, "Memory", StringComparison.OrdinalIgnoreCase))
            {
                var name = node.MemoryVariableName ?? "";
                if (!string.IsNullOrWhiteSpace(name)) _memory[name] = value ?? "";
                return StepOutcome.Success;
            }
            // A page target types the value exactly as InputContent would.
            return await _actions.RunAsync(_browser.Driver, node, value, ct);
        }

        // Row-level actions change the SHAPE of a source's content, so they are not a page action and
        // not a single cell write: they are handled here where the local/server split for a source is
        // already decided.
        if (action is "InsertRow" or "DeleteRow")
            return await ResizeRowsAsync(graph, node, rowIndex, ct);

        return await _actions.RunAsync(_browser.Driver, node, value, ct);
    }

    /// <summary>
    /// The wait budget for a step's element lookup, in milliseconds.
    /// </summary>
    /// <remarks>
    /// Mirrors <c>selectorWaitBudget</c>: the switch is off by default and means "one attempt". On,
    /// it is a budget of at least 200ms, with a blank value meaning one second. An InsertContent
    /// that reads its value off the page has no target element, so the VALUE-side switch governs it.
    /// </remarks>
    private static int ActionWaitBudgetMs(GraphNode node, string action)
    {
        var target = WaitBudgetMs(node, equal: false);
        var valueSide = IsElementsValueSource(node) ? WaitBudgetMs(node, equal: true) : 0;
        // Either switch is the author saying "wait for this": one loop wraps both lookups.
        return Math.Max(target, valueSide);
    }

    /// <summary>Whether the node's value comes from a page element («عنصر صفحه»).</summary>
    private static bool IsElementsValueSource(GraphNode node)
        => string.Equals(
            node.ContentSourceType ?? node.ReadExtraString("valueSourceType"),
            "Elements",
            StringComparison.OrdinalIgnoreCase);

    /// <summary>The selector wait budget of one side of a node, in milliseconds (0 = one attempt).</summary>
    private static int WaitBudgetMs(GraphNode node, bool equal)
    {
        var enabled = equal
            ? node.ReadExtraBool("equalSelectorWaitEnabled", false)
            : node.SelectorWaitEnabled == true;
        if (!enabled) return 0;
        var raw = equal ? node.ReadExtraInt("equalSelectorWaitMs") ?? 0 : node.SelectorWaitMs ?? 0;
        return Math.Max(200, raw > 0 ? raw : 1000);
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

        // «آدرس صفحه»: the current URL of the run's browser, read at the moment this step runs.
        if (string.Equals(srcType, "PageUrl", StringComparison.OrdinalIgnoreCase))
            return _browser.IsOpen ? _browser.Driver.Url : "";

        // «عنصر صفحه» is read from the page inside the action (inside its frame chain); nothing can
        // be resolved here, and returning the constant would type the wrong text.
        if (string.Equals(srcType, "Elements", StringComparison.OrdinalIgnoreCase)) return null;

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
            return ConditionEvaluator.SystemClock("SystemDate", node.ReadExtraString("systemClockFormat"));
        if (string.Equals(srcType, "SystemTime", StringComparison.OrdinalIgnoreCase))
            return ConditionEvaluator.SystemClock("SystemTime", node.ReadExtraString("systemClockFormat"));
        // A step's "system value" picker: the node may say System + a named value instead of
        // SystemDate/SystemTime. Both spellings exist in saved graphs; honouring only one made the
        // action capture a literal empty string.
        if (string.Equals(srcType, "System", StringComparison.OrdinalIgnoreCase))
        {
            var which = node.ReadExtraString("systemValueType");
            var fmt = node.ReadExtraString("systemClockFormat");
            return which switch
            {
                "CurrentDate" => ConditionEvaluator.SystemClock("SystemDate", fmt),
                "CurrentTime" => ConditionEvaluator.SystemClock("SystemTime", fmt),
                "CurrentDateTime" => $"{ConditionEvaluator.SystemClock("SystemDate", fmt)} " +
                                     $"{ConditionEvaluator.SystemClock("SystemTime", fmt)}",
                // The editor's picker names these exactly; «Guid» is kept for older saved graphs.
                "Timestamp" => DateTimeOffset.Now.ToUnixTimeMilliseconds().ToString(),
                "Uuid" or "Guid" => Guid.NewGuid().ToString(),
                "RandomInt" => Random.Shared.Next(0, 1_000_000_000).ToString(),
                _ => node.ConstantValue ?? ""
            };
        }

        return node.ConstantValue ?? node.NavigateUrl ?? "";
    }

    private string ReadCell(ProcessGraph graph, int? dsId, int rowIndex, string columnKey)
        => TryReadCell(graph, dsId, rowIndex, columnKey, out var value) ? value : "";

    /// <summary>
    /// Read one cell, reporting whether it could be read at all.
    /// </summary>
    /// <remarks>
    /// The difference matters to a dynamic selector: an empty CELL is a value, while an unreadable
    /// one must refuse the step instead of building a selector from nothing.
    /// </remarks>
    private bool TryReadCell(ProcessGraph graph, int? dsId, int rowIndex, string columnKey, out string value)
    {
        value = "";
        if (dsId is null || dsId <= 0 || string.IsNullOrWhiteSpace(columnKey)) return false;

        var key = CellKey(dsId.Value, rowIndex, columnKey);
        if (_localCells.TryGetValue(key, out var cached))
        {
            value = cached;
            return true;
        }

        // Server mode reads every source from the server; a local run reads its private ones from the
        // mirror it loaded before starting, and only shared sources remotely — a shared source is
        // authoritative on the server even in a local run, because other people are writing it.
        var isShared = graph.DataSources.FirstOrDefault(d => d.Id == dsId)?.IsPublic == true;
        if (_allowServerCalls || isShared)
        {
            var remote = _client.ReadCellAsync(dsId.Value, rowIndex, columnKey).GetAwaiter().GetResult();
            if (remote is not null)
            {
                _localCells[key] = remote;
                value = remote;
                return true;
            }
        }
        return false;
    }

    /// <summary>
    /// Write one cell.
    /// </summary>
    /// <remarks>
    /// Server mode keeps EVERY source on the server — that is what the mode means — while a local run
    /// keeps private ones to itself and leaves shared ones on the server, because a shared source's
    /// whole point is that everyone reads the same values. The condition therefore asks "may this run
    /// call the server at all, or is the source shared?", not "is the source shared?" — the latter
    /// sent a server run's private writes into a mirror that nobody ever read.
    /// </remarks>
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
        var cellKey = CellKey(dsId.Value, targetRow, col);

        // How the incoming value meets what is already in the cell:
        // Replace (default) / Prepend (incoming first) / Append (incoming last), joined by the
        // step's separator. The server composes server-backed cells under its row lock; a local
        // run's own mirror is composed here.
        var insertMode = (node.ReadExtraString("insertMode") ?? "").Trim();
        if (insertMode.Length == 0) insertMode = "Replace";
        var separator = node.ReadExtraString("insertSeparator");
        var composing = !string.Equals(insertMode, "Replace", StringComparison.OrdinalIgnoreCase);
        var storedText = composing
            ? ComposeInsert(insertMode, text, ReadCell(graph, dsId, targetRow, col), separator)
            : text;

        // Capture the PRE-WRITE value before overwriting the table: that is the only way the server
        // can later tell "nobody else changed this cell" from a genuine conflict. Only the first
        // write to a cell contributes a base — a later write in the same run would record this run's
        // own previous value and make every cell look conflicted.
        string? baseValue = null;
        if (State.Writes.All(w => w.DataSourceId != dsId.Value || w.RowIndex != targetRow || w.ColumnKey != col))
        {
            baseValue = _localCells.TryGetValue(cellKey, out var before) && before is not null
                ? before
                : ReadCell(graph, dsId, targetRow, col);
        }
        _localCells[cellKey] = storedText;
        State.Writes.Add(new LocalCellWrite(dsId.Value, targetRow, col, storedText, baseValue));
        Log("info", $"نوشتن در منبع #{dsId} ستون «{col}» ردیف {targetRow + 1}");

        var isShared = graph.DataSources.FirstOrDefault(d => d.Id == dsId)?.IsPublic == true;
        if (_allowServerCalls || isShared)
        {
            // The RAW text plus the mode travel to the server: composing here and sending the
            // composed value would join it with the old value twice.
            var ok = _client.PatchCellAsync(dsId.Value, targetRow, col, text, insertMode, separator)
                .GetAwaiter().GetResult();
            if (!ok) return StepOutcome.Fail(
                isShared ? "نوشتن در منبع عمومی روی سرور ناموفق بود." : "نوشتن در منبع روی سرور ناموفق بود.");
        }
        return StepOutcome.Success;
    }

    /// <summary>Join an incoming value with the cell's previous value for Prepend/Append.</summary>
    private static string ComposeInsert(string mode, string incoming, string previous, string separator)
    {
        // An empty cell has nothing to join with, so the value is stored as-is.
        if (previous.Length == 0) return incoming;
        return string.Equals(mode, "Prepend", StringComparison.OrdinalIgnoreCase)
            ? incoming + separator + previous
            : previous + separator + incoming;
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
    private ConditionResult EvaluateCondition(
        ProcessGraph graph, GraphNode node, int nodeRow, int? selectorRow, RowScope scope)
    {
        try
        {
            _selectors?.ResolveNode(node, nodeRow, selectorRow, scope);
        }
        catch (Exception ex)
        {
            // A selector whose data could not be read must not be evaluated as "no match": the
            // verdict would send the walk down the fail branch for the wrong reason.
            return ConditionResult.Failed($"بررسی شرط ممکن نشد: {ex.Message}");
        }

        try
        {
            // A condition that needs no page is evaluated with NO driver: the run may not have
            // opened a browser at all, and touching Driver would throw before the check runs.
            if (!_browser.IsOpen)
                return _conditions.Evaluate(null, graph, node, nodeRow, _memory,
                    (dsId, row, col) => ReadCell(graph, dsId, row, col));

            using var frame = FrameNavigator.Enter(_browser.Driver, node);
            return _conditions.Evaluate(_browser.Driver, graph, node, nodeRow, _memory,
                (dsId, row, col) => ReadCell(graph, dsId, row, col));
        }
        catch (Exception ex)
        {
            return ConditionResult.Failed($"بررسی شرط ممکن نشد: {ex.Message}");
        }
    }

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

        // Same rule as a cell write: a server run edits the server's rows whatever the source is; a
        // local run edits its own mirror for private sources and the server for shared ones.
        if (!(_allowServerCalls || isShared))
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
        State.AppendLog(new RunLogLine(DateTime.UtcNow, kind, text));
        Changed?.Invoke();
    }

    /// <summary>Remember that the session is gone; the walk stops at the next boundary.</summary>
    private void OnAuthRejected() => _authRejected = true;
}
