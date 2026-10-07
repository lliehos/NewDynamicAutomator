using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using Morobot.Desktop.Models;
using Morobot.Desktop.Services;

namespace Morobot.Desktop;

/// <summary>
/// The runner's shell: sign in, see the process list, start a run.
/// </summary>
/// <remarks>
/// Login state is remembered as a token, not as the password. The app is a client of the panel, and
/// the panel already issues a bearer token the extension uses — storing the password to re-mint one
/// would spread the credential further than the panel ever intended.
/// </remarks>
public partial class MainWindow : Window
{
    private readonly ObservableCollection<ProcessRow> _rows = new();
    private PanelClient? _client;
    private LicenseGate _license = LicenseGate.Blocked();

    /// <summary>Open run windows, so several runs can be watched at once.</summary>
    private readonly List<RunWindow> _runs = new();

    public MainWindow()
    {
        InitializeComponent();
        ProcessGrid.ItemsSource = _rows;
        Loaded += async (_, _) => await BootstrapAsync();
        LicenseText.Text = DsStrings.LicenseMissing;
    }

    // ---- Startup --------------------------------------------------------------------------------

    private async Task BootstrapAsync()
    {
        var saved = AppSettings.Load();
        ServerUrlBox.Text = saved.ServerUrl ?? "https://";
        UserBox.Text = saved.UserName ?? "";
        RememberBox.IsChecked = saved.Remember;

        if (!string.IsNullOrWhiteSpace(saved.ServerUrl) && !string.IsNullOrWhiteSpace(saved.Token))
        {
            _client = new PanelClient(saved.ServerUrl);
            var res = await _client.UseTokenAsync(saved.Token!, saved.UserName);
            if (res.Ok)
            {
                await AfterLoginAsync();
                return;
            }
            // A stale token is normal (it expires); fall back to the login form rather than
            // reporting an error the user cannot act on.
            saved.Token = null;
            AppSettings.Save(saved);
        }
    }

    // ---- Login ----------------------------------------------------------------------------------

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        var url = ServerUrlBox.Text?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out _))
        {
            LoginStatus.Text = DsStrings.ErrServerUrl;
            return;
        }
        var user = UserBox.Text?.Trim() ?? "";
        var pass = PassBox.Password;
        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrEmpty(pass))
        {
            LoginStatus.Text = DsStrings.ErrCredentials;
            return;
        }

        LoginButton.IsEnabled = false;
        LoginStatus.Text = DsStrings.LoggingIn;
        try
        {
            _client = new PanelClient(url);
            var res = await _client.LoginAsync(user, pass);
            if (!res.Ok)
            {
                LoginStatus.Text = res.Error;
                return;
            }
            LoginStatus.Text = "";
            PassBox.Password = "";
            AppSettings.Save(new AppSettings
            {
                ServerUrl = _client.BaseUrl,
                UserName = res.Value,
                Remember = RememberBox.IsChecked == true,
                Token = RememberBox.IsChecked == true ? _client.AccessToken : null
            });
            await AfterLoginAsync();
        }
        finally
        {
            LoginButton.IsEnabled = true;
        }
    }

    private async Task AfterLoginAsync()
    {
        if (_client is null) return;
        LoginPanel.Visibility = Visibility.Collapsed;
        ProcessPanel.Visibility = Visibility.Visible;
        WhoamiText.Text = $"کاربر: {_client.UserName} — {_client.BaseUrl}";

        _license = LicenseGate.FromJson(await _client.GetLicenseJsonAsync());
        LicenseText.Text = _license.AllowsLocalRun
            ? $"لایسنس: اجرای محلی فعال{(string.IsNullOrWhiteSpace(_license.OrganizationName) ? "" : $" — {_license.OrganizationName}")}"
            : DsStrings.LicenseBlocked;
        LicenseText.Foreground = _license.AllowsLocalRun
            ? (System.Windows.Media.Brush)FindResource("DsSuccessBrush")
            : (System.Windows.Media.Brush)FindResource("DsDangerBrush");

        await LoadProcessesAsync();
    }

    private void Logout_Click(object sender, RoutedEventArgs e)
    {
        _client?.Dispose();
        _client = null;
        var saved = AppSettings.Load();
        saved.Token = null;
        AppSettings.Save(saved);

        foreach (var r in _runs.ToList()) { try { r.Close(); } catch { /* already closed */ } }
        _runs.Clear();

        ProcessPanel.Visibility = Visibility.Collapsed;
        LoginPanel.Visibility = Visibility.Visible;
    }

    // ---- Process list ---------------------------------------------------------------------------

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await LoadProcessesAsync();

    private async Task LoadProcessesAsync()
    {
        if (_client is null) return;
        ListStatus.Text = DsStrings.Refreshing;
        var res = await _client.ListProcessesAsync();
        if (!res.Ok)
        {
            ListStatus.Text = res.Error;
            return;
        }
        _rows.Clear();
        foreach (var r in res.Value!) _rows.Add(r);
        ListStatus.Text = _rows.Count == 0 ? DsStrings.NoProcesses : $"{_rows.Count} فرآیند";
    }

    // ---- Row actions ----------------------------------------------------------------------------

    private async void RowRun_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { DataContext: ProcessRow row } || _client is null) return;

        if (!_license.AllowsLocalRun && !row.RunOnServer)
        {
            MessageBox.Show(this, DsStrings.LicenseBlockedBody, DsStrings.LicenseBlocked,
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var canvas = await _client.GetCanvasAsync(row.Id);
        if (!canvas.Ok)
        {
            MessageBox.Show(this, canvas.Error, "خطا", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }
        var graph = ProcessGraph.Parse(canvas.Value);
        if (graph is null)
        {
            MessageBox.Show(this, "دیاگرام فرآیند قابل خواندن نبود.", "خطا", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        // More than one iteration means the user has to say which rows to run — the same question
        // the extension asks before it starts.
        var rowIndices = new List<int> { 0 };
        var totalRows = ResolveIterationCount(graph);
        if (totalRows > 1)
        {
            var picker = new RepeatIndexWindow(totalRows) { Owner = this };
            if (picker.ShowDialog() != true) return;
            rowIndices = picker.SelectedIndices;
            if (rowIndices.Count == 0) return;
        }

        var prereq = FirefoxRunner.CheckPrerequisites();
        if (!prereq.ok)
        {
            MessageBox.Show(this, $"{DsStrings.DriverMissingBody}\n\n{prereq.detail}", DsStrings.DriverMissing,
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var runWindow = new RunWindow(_client, _browser => new LocalRunEngine(_client, _browser, row.RunOnServer));
        runWindow.Configure(row.Title, graph, rowIndices, row.RunOnServer);
        runWindow.Closed += (_, _) =>
        {
            _runs.Remove(runWindow);
            // A local run that wrote anything needs a sync before its results reach the server.
            if (!row.RunOnServer && runWindow.Engine?.State.Writes.Count > 0 && runWindow.Engine.State.LastError is null)
                row.LocalRunPendingSync = true;
        };
        _runs.Add(runWindow);
        runWindow.Show();
        runWindow.StartRun();
    }

    /// <summary>How many rows this process iterates, from its start node and default source.</summary>
    private static int ResolveIterationCount(ProcessGraph graph)
    {
        var start = graph.StartNode;
        if (start is null) return 1;
        var repeat = start.ReadExtraString("repeatSourceType");
        if (!string.Equals(repeat, "DataSource", StringComparison.OrdinalIgnoreCase)) return 1;
        var dsId = start.DataSourceId ?? 0;
        var ds = graph.DataSources.FirstOrDefault(d => d.Id == dsId);
        return Math.Max(1, ds?.RowCount ?? 1);
    }

    private void RowEdit_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { DataContext: ProcessRow row } || _client is null) return;
        // Editing belongs in the panel, where the full editor lives. Opening the browser is the
        // honest answer; re-implementing the editor here would be a second, divergent one.
        var url = $"{_client.BaseUrl}/Panel/Tasks/Editor/{row.Id}";
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"باز کردن ویرایشگر ناموفق بود: {ex.Message}", "خطا",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void RowSync_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { DataContext: ProcessRow row } || _client is null) return;
        if (!row.LocalRunPendingSync)
        {
            MessageBox.Show(this, "برای این فرآیند نتیجهٔ محلی‌ای برای سینک وجود ندارد.",
                DsStrings.SyncConfirmTitle, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        // Explicit, and worded as a data-loss risk: a local run is off the server's books, so this is
        // the only moment the two copies meet and the server's version can be replaced.
        var confirm = MessageBox.Show(this, DsStrings.SyncConfirmBody, DsStrings.SyncConfirmTitle,
            MessageBoxButton.OKCancel, MessageBoxImage.Warning);
        if (confirm != MessageBoxResult.OK) return;

        var engineState = FindLatestRunState(row.Id);
        var cells = (engineState?.Writes ?? new List<LocalCellWrite>())
            .Select(w => (object)new { w.DataSourceId, w.RowIndex, w.ColumnKey, w.CellValue })
            .ToList();

        var res = await _client.SyncLocalRunAsync(row.Id, engineState?.StartedAtUtc, cells);
        if (!res.Ok)
        {
            MessageBox.Show(this, res.Error, DsStrings.SyncFailed, MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }
        row.LocalRunPendingSync = false;
        MessageBox.Show(this, DsStrings.SyncDone, DsStrings.SyncConfirmTitle,
            MessageBoxButton.OK, MessageBoxImage.Information);
    }

    /// <summary>
    /// The most recent run state for a process, used as the sync payload.
    /// </summary>
    /// <remarks>
    /// The writes live in the run's own engine while it exists. Keeping the last one around after
    /// the window closes is what makes Sync possible at all — the run is over, but its results are
    /// exactly what the user is asking to push.
    /// </remarks>
    private RunState? FindLatestRunState(int taskId)
    {
        RunState? best = null;
        foreach (var w in _runs)
        {
            var st = w.Engine?.State;
            if (st is null) continue;
            if (best is null || st.StartedAtUtc > best.StartedAtUtc) best = st;
        }
        return best;
    }

    private void DriverCheck_Click(object sender, RoutedEventArgs e)
    {
        var (ok, detail) = FirefoxRunner.CheckPrerequisites();
        MessageBox.Show(this,
            ok ? $"پیش‌نیازها آماده است.\n\n{detail}" : $"{DsStrings.DriverMissingBody}\n\n{detail}",
            ok ? "بررسی پیش‌نیازها" : DsStrings.DriverMissing,
            MessageBoxButton.OK, ok ? MessageBoxImage.Information : MessageBoxImage.Warning);
    }
}

/// <summary>
/// Persisted connection settings. Only the token is sensitive, and only when the user opts in.
/// </summary>
internal sealed class AppSettings
{
    public string? ServerUrl { get; set; }
    public string? UserName { get; set; }
    public bool Remember { get; set; }
    public string? Token { get; set; }

    private static string FilePath
    {
        get
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MorobotDesktop");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "settings.json");
        }
    }

    public static AppSettings Load()
    {
        try
        {
            var path = FilePath;
            if (!File.Exists(path)) return new AppSettings();
            return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path)) ?? new AppSettings();
        }
        catch { return new AppSettings(); }
    }

    public static void Save(AppSettings settings)
    {
        try
        {
            // The token is only written when the user asked to be remembered; "not now" must not
            // leave a credential on disk anyway.
            var toWrite = new AppSettings
            {
                ServerUrl = settings.ServerUrl,
                UserName = settings.UserName,
                Remember = settings.Remember,
                Token = settings.Remember ? settings.Token : null
            };
            File.WriteAllText(FilePath, JsonSerializer.Serialize(toWrite, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* settings that cannot be saved must not block the app */ }
    }
}
