using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Threading;
using Morobot.Desktop.Models;
using Morobot.Desktop.Services;

namespace Morobot.Desktop;

/// <summary>
/// The live result window for one run.
/// </summary>
/// <remarks>
/// Mirrors the extension's HUD: the same status line, the same step counter and the same log, so a
/// user who knows one recognises the other. Each run gets its own window and its own engine, which
/// is what makes several simultaneous runs readable instead of interleaved.
/// </remarks>
public partial class RunWindow : Window, INotifyPropertyChanged
{
    private readonly PanelClient _client;
    private readonly Func<FirefoxRunner, LocalRunEngine> _engineFactory;
    private readonly DispatcherTimer _timer;
    private ProcessGraph? _graph;
    private List<int> _rowIndices = new();

    private string _statusLabel = "آماده";
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
        // The engine reports progress from its own thread; the timer keeps the UI in step without
        // the engine having to know it is being displayed.
        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _timer.Tick += (_, _) => RefreshUi();
    }

    public void Configure(string title, ProcessGraph graph, List<int> rowIndices, bool runOnServer)
    {
        Title = $"نتیجهٔ اجرا — {title}";
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
        Engine.State.StepTotal = _graph.Nodes.Count(n => n.IsAction);
        StatusLabel = "در حال آماده‌سازی…";
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
                    StatusLabel = Engine.State.LastError is not null
                        ? "اجرا با خطا تمام شد"
                        : Engine.State.Stopped ? "اجرا متوقف شد" : "اجرا تمام شد";
                });
            }
        });
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
        if (s.Running) StatusLabel = "در حال اجرا…";

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

    private void Stop_Click(object sender, RoutedEventArgs e)
    {
        Engine?.Stop();
        StopButton.IsEnabled = false;
        StatusLabel = "در حال توقف…";
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
