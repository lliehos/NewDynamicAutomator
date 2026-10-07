using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Threading;
using Morobot.Player.Models;
using Morobot.Player.Services;

namespace Morobot.Player;

/// <summary>
/// The player: the live view of one run.
/// </summary>
/// <remarks>
/// Deliberately the same shape as the extension's play HUD — a title, one status line, a progress
/// readout, a result list, and the play/pause, stop and clear controls in the same order — because a
/// user who knows one should not have to learn the other. The difference is only where it lives: a
/// window here, an overlay there.
///
/// Each run gets its own window and its own engine, which is what makes several simultaneous runs
/// readable instead of interleaved.
/// </remarks>
public partial class RunWindow : Window, INotifyPropertyChanged
{
    private readonly PanelClient _client;
    private readonly Func<FirefoxRunner, LocalRunEngine> _engineFactory;
    private readonly DispatcherTimer _timer;
    private ProcessGraph? _graph;
    private List<int> _rowIndices = new();

    private string _statusLabel = DsStrings.RunReady;
    public string StatusLabel
    {
        get => _statusLabel;
        set { _statusLabel = value; OnChanged(); }
    }

    public LocalRunEngine? Engine { get; private set; }

    public RunWindow(PanelClient client, Func<FirefoxRunner, LocalRunEngine> engineFactory)
    {
        InitializeComponent();
        _client = client;
        _engineFactory = engineFactory;
        DataContext = this;
        // The engine reports progress from its own thread; a timer keeps the UI in step without the
        // engine having to know it is being displayed.
        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _timer.Tick += (_, _) => RefreshUi();
    }

    public void Configure(string title, ProcessGraph graph, List<int> rowIndices, bool runOnServer)
    {
        Title = $"{PlayerIdentity.ProductName} — {title}";
        TitleText.Text = title;
        _graph = graph;
        _rowIndices = rowIndices;
        ModeBadge.Text = runOnServer ? "حالت سرور" : "حالت محلی";
        ModeBadge.Foreground = runOnServer
            ? (System.Windows.Media.Brush)FindResource("DsPrimaryBrush")
            : (System.Windows.Media.Brush)FindResource("DsWarnBrush");
    }

    public void StartRun()
    {
        if (_graph is null) return;
        var browser = new FirefoxRunner();
        Engine = _engineFactory(browser);
        // The engine owns the highlight colour; the window just shows the current value.
        Engine.HighlightColor = ReadStartHighlightColor(_graph);
        Engine.State.StepTotal = Math.Max(1, _graph.Nodes.Count(n => n.IsAction));
        StatusLabel = DsStrings.RunStarting;
        _timer.Start();

        _ = Task.Run(async () =>
        {
            try
            {
                await Engine.StartAsync(_graph, _rowIndices);
            }
            finally
            {
                try { browser.Dispose(); } catch { /* the browser may already be gone */ }
                Dispatcher.Invoke(() =>
                {
                    _timer.Stop();
                    RefreshUi();
                    StopButton.IsEnabled = false;
                    PlayPauseButton.IsEnabled = false;
                    SettingsButton.IsEnabled = false;
                    StatusLabel = Engine.State.LastError is not null
                        ? DsStrings.RunFailed
                        : Engine.State.Stopped ? DsStrings.RunStopped : DsStrings.RunDone;
                });
            }
        });
    }

    private static string ReadStartHighlightColor(ProcessGraph graph)
    {
        var start = graph.StartNode;
        var raw = start?.HighlightColor ?? start?.ReadExtraString("highlightColor");
        return string.IsNullOrWhiteSpace(raw) ? "#7367F0" : raw;
    }

    private void RefreshUi()
    {
        if (Engine is null) return;
        var s = Engine.State;

        Progress.Maximum = Math.Max(1, s.StepTotal);
        Progress.Value = Math.Min(s.StepIndex, Progress.Maximum);

        StepText.Text = s.StepTotal > 0
            ? $"مرحله {s.StepIndex} از {s.StepTotal} · حلقه {s.LoopIndex} از {s.LoopTotal}"
            : "";

        // The glyph carries the run state at a glance, the way the HUD's ▶/⏸ does.
        ProgressGlyph.Text = s.Paused ? "⏸" : s.Running ? "▶" : "■";
        if (s.Running) StatusLabel = s.Paused ? "توقف موقت" : DsStrings.RunInProgress;
        PlayPauseButton.Content = s.Paused ? "ادامه" : "توقف موقت";

        // Rebuild the log only when it grew: a full reset every tick would fight the user's selection.
        if (LogList.Items.Count != s.Log.Count)
        {
            LogList.Items.Clear();
            foreach (var line in s.Log)
                LogList.Items.Add($"[{line.AtUtc.ToLocalTime():HH:mm:ss}] {line.Text}");
            if (LogList.Items.Count > 0)
                LogList.ScrollIntoView(LogList.Items[^1]);
        }

        ElapsedText.Text = s.Running
            ? $"زمان: {(DateTime.UtcNow - s.StartedAtUtc).TotalSeconds:0} ثانیه"
            : $"پایان: {DateTime.UtcNow.ToLocalTime():HH:mm:ss}";
    }

    private void PlayPause_Click(object sender, RoutedEventArgs e)
    {
        if (Engine is null || !Engine.IsRunning) return;
        Engine.SetPaused(!Engine.State.Paused);
        RefreshUi();
    }

    private void Stop_Click(object sender, RoutedEventArgs e)
    {
        Engine?.Stop();
        StopButton.IsEnabled = false;
        PlayPauseButton.IsEnabled = false;
        StatusLabel = "در حال توقف…";
    }

    private void Clear_Click(object sender, RoutedEventArgs e)
    {
        if (Engine is null) return;
        Engine.State.Log.Clear();
        LogList.Items.Clear();
    }

    /// <summary>
    /// Edit the step gap and highlight colour for this run.
    /// </summary>
    /// <remarks>
    /// Only before the run starts, or while it is paused: changing the gap mid-run would make the
    /// pacing of the steps already taken disagree with the steps to come, and changing the colour
    /// mid-run would leave two colours on the page meaning the same thing.
    /// </remarks>
    private void Settings_Click(object sender, RoutedEventArgs e)
    {
        if (_graph is null || Engine is null) return;
        var running = Engine.IsRunning && !Engine.State.Paused;
        if (running)
        {
            MessageBox.Show(this, "برای تغییر تنظیمات، اجرا را موقتاً متوقف کنید.",
                "تنظیمات اجرا", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var dialog = new RunSettingsWindow(_graph.StepDelayMs, Engine.HighlightColor) { Owner = this };
        if (dialog.ShowDialog() != true) return;

        _graph.StepDelayMs = dialog.StepDelayMs;
        Engine.HighlightColor = dialog.HighlightColor;
        // Persisted so the setting belongs to the process rather than to this one run — the same
        // promise the panel editor makes when it writes these two fields.
        _ = PersistRunSettingsAsync(dialog.StepDelayMs, dialog.HighlightColor);
    }

    private async Task PersistRunSettingsAsync(int stepDelayMs, string highlightColor)
    {
        var taskId = _graph is null ? 0 : ReadTaskId(_graph);
        if (taskId <= 0) return;
        var res = await _client.SaveRunSettingsAsync(taskId, stepDelayMs, highlightColor);
        Dispatcher.Invoke(() =>
        {
            if (!res.Ok)
                MessageBox.Show(this, res.Error ?? "ذخیرهٔ تنظیمات ناموفق بود.", "تنظیمات اجرا",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
        });
    }

    private static int ReadTaskId(ProcessGraph graph)
    {
        try
        {
            var raw = graph.TaskIdRaw;
            if (raw.ValueKind == System.Text.Json.JsonValueKind.Number && raw.TryGetInt32(out var n)) return n;
            if (raw.ValueKind == System.Text.Json.JsonValueKind.String && int.TryParse(raw.GetString(), out var s)) return s;
        }
        catch { /* a graph with no id cannot persist anything */ }
        return 0;
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        if (Engine?.IsRunning == true)
        {
            var ok = MessageBox.Show(this, "اجرا در جریان است. متوقف و بسته شود؟", "بستن",
                MessageBoxButton.OKCancel, MessageBoxImage.Question);
            if (ok != MessageBoxResult.OK) return;
            Engine.Stop();
        }
        Close();
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        _timer.Stop();
        base.OnClosing(e);
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
