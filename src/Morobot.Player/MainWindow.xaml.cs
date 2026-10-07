using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using Morobot.Player.Models;
using Morobot.Player.Services;

namespace Morobot.Player;

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
    private UpdateListener? _updateListener;

    /// <summary>Open run windows, so several runs can be watched at once.</summary>
    private readonly List<RunWindow> _runs = new();

    public MainWindow()
    {
        InitializeComponent();
        ProcessGrid.ItemsSource = _rows;
        ApplyProductName();
        Loaded += async (_, _) => await BootstrapAsync();
        LicenseText.Text = DsStrings.LicenseMissing;
    }

    /// <summary>
    /// Name the window after the deployment, once its branding is known.
    /// </summary>
    /// <remarks>
    /// Called again after sign-in, when the panel's own app name replaces the shipped default — so
    /// a customer's installation calls itself their product name plus "Player", not ours.
    /// </remarks>
    private void ApplyProductName()
    {
        Title = PlayerIdentity.ProductName;
        ProductNameText.Text = PlayerIdentity.ProductName;
        LoginProductName.Text = PlayerIdentity.ProductName;
    }

    // ---- Startup --------------------------------------------------------------------------------

    private async Task BootstrapAsync()
    {
        var saved = AppSettings.Load();

        // The server address comes from the licence on disk, never from the user. If no licence has
        // been imported yet, ServerAddress falls back to the development pair so the app is still
        // usable while a deployment is being set up.
        ResolveServerAddress();
        ServerLabel.Text = ServerAddress.BaseUrl ?? "";

        // Check for an update before sign-in. The endpoint is unauthenticated precisely so a client
        // too old to talk to this server is told to update rather than failing at login with an
        // error it cannot interpret.
        _ = CheckForUpdateAsync(ServerAddress.BaseUrl, interactive: false);

        if (!string.IsNullOrWhiteSpace(ServerAddress.BaseUrl) && !string.IsNullOrWhiteSpace(saved.Token))
        {
            _client = new PanelClient(ServerAddress.BaseUrl);
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

        if (!ServerAddress.IsFromLicense)
            LoginStatus.Text = DsStrings.LicenseMissing;
    }

    /// <summary>
    /// Read the signed licence to learn which server this install belongs to.
    /// </summary>
    /// <remarks>
    /// Best-effort: the app must still open when no licence is present, because the licence is also
    /// what gates local execution and its absence is reported later and more meaningfully than a
    /// failure to start would be.
    /// </remarks>
    private void ResolveServerAddress()
    {
        // The panel hands this install its licence on every sign-in, but the address is needed
        // BEFORE sign-in — that is the whole point of not asking for it. So it is read from the
        // copy the panel already mirrored locally, and a missing copy simply means the development
        // fallback.
        try
        {
            var payload = LicenseGate.ReadLocalPayload();
            ServerAddress.Resolve(payload?.ServerBaseUrl, payload?.AllowedHost);
        }
        catch
        {
            // A corrupt or unreadable licence falls back to the development address rather than
            // blocking the window; the licence gate reports the real problem after sign-in.
            ServerAddress.Resolve(null, null);
        }
    }

    /// <summary>
    /// Look for a newer runner build and offer to install it.
    /// </summary>
    /// <remarks>
    /// Offered rather than forced: an update replaces the running executable, so doing that without
    /// consent mid-session would be a surprise. The user decides when to restart.
    /// </remarks>
    private async Task CheckForUpdateAsync(string? serverUrl, bool interactive)
    {
        if (string.IsNullOrWhiteSpace(serverUrl)) return;
        var info = await UpdateService.CheckAsync(serverUrl);
        if (info is null || !info.Available) return;
        if (!UpdateService.IsNewer(info.Version, UpdateService.CurrentVersion)) return;

        var ask = MessageBox.Show(this,
            $"نسخهٔ جدید {info.Version} روی سرور موجود است (نسخهٔ فعلی {UpdateService.CurrentVersion}).\n\n" +
            "اکنون دانلود و نصب شود؟ برنامه پس از نصب دوباره باز می‌شود.",
            "به‌روزرسانی",
            MessageBoxButton.YesNo, MessageBoxImage.Information);
        if (ask != MessageBoxResult.Yes) return;

        UpdateStatus.Text = "در حال دانلود به‌روزرسانی…";
        var progress = new Progress<int>(p => UpdateStatus.Text = $"در حال دانلود به‌روزرسانی… {p}%");
        var (ok, newExe, error) = await UpdateService.DownloadAndStageAsync(
            serverUrl, info.DownloadUrl ?? "/desktop/download", progress);

        if (!ok || newExe is null)
        {
            UpdateStatus.Text = error ?? "به‌روزرسانی ناموفق بود.";
            return;
        }

        UpdateStatus.Text = "به‌روزرسانی آماده است؛ برنامه در حال راه‌اندازی مجدد…";
        // Start the new build, then close this one so the file lock on the old exe is released. The
        // new build runs from its staging folder, which is the only way Windows allows this.
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(newExe)
            {
                UseShellExecute = true,
                WorkingDirectory = System.IO.Path.GetDirectoryName(newExe)
            });
        }
        catch (Exception ex)
        {
            UpdateStatus.Text = $"اجرای نسخهٔ جدید ناموفق بود: {ex.Message}";
            return;
        }
        Application.Current.Shutdown();
    }

    // ---- Login ----------------------------------------------------------------------------------

    /// <summary>
    /// Sign in through the browser.
    /// </summary>
    /// <remarks>
    /// The password is never typed into this app. The user signs in on the server's own page — with
    /// the address bar they can check and whatever second factor their account has — and the app
    /// receives a token afterwards. Asking for a panel password on a desktop window would train the
    /// user to type it into something that is not the panel, which is the habit that makes phishing
    /// work.
    /// </remarks>
    private async void BrowserLogin_Click(object sender, RoutedEventArgs e)
    {
        var baseUrl = ServerAddress.BaseUrl;
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            LoginStatus.Text = DsStrings.ErrServerUrl;
            return;
        }

        BrowserLoginButton.IsEnabled = false;
        LoginStatus.Foreground = (System.Windows.Media.Brush)FindResource("DsMutedBrush");
        LoginStatus.Text = DsStrings.LoggingIn;
        try
        {
            _client = new PanelClient(baseUrl);
            var res = await _client.LoginWithBrowserAsync(
                status => Dispatcher.Invoke(() => LoginStatus.Text = status));

            if (!res.Ok)
            {
                LoginStatus.Foreground = (System.Windows.Media.Brush)FindResource("DsDangerBrush");
                LoginStatus.Text = res.Error ?? DsStrings.LoginFailed;
                return;
            }

            LoginStatus.Text = "";
            // The token is kept so a restart does not force a browser round-trip; it is the same
            // kind of token the extension stores, and it expires on the server's own schedule.
            var saved = AppSettings.Load();
            saved.ServerUrl = baseUrl;
            saved.UserName = res.Value;
            saved.Token = _client.AccessToken;
            saved.Remember = true;
            AppSettings.Save(saved);

            await AfterLoginAsync();
        }
        finally
        {
            BrowserLoginButton.IsEnabled = true;
        }
    }

    private async Task AfterLoginAsync()
    {
        if (_client is null) return;
        LoginPanel.Visibility = Visibility.Collapsed;
        ProcessPanel.Visibility = Visibility.Visible;
        WhoamiText.Text = $"کاربر: {_client.UserName} — {_client.BaseUrl}";

        // Branding first, so the window and every later prompt carry the deployment's own product
        // name rather than the shipped one.
        PlayerIdentity.SetAppName(await _client.GetAppNameAsync());
        ApplyProductName();

        var licenseJson = await _client.GetLicenseJsonAsync();
        // Mirrored to disk so the next launch knows its server address before it can sign in.
        LicenseGate.CacheLocal(licenseJson);
        _license = LicenseGate.FromJson(licenseJson);
        LicenseText.Text = _license.AllowsLocalRun
            ? $"لایسنس: اجرای محلی فعال{(string.IsNullOrWhiteSpace(_license.OrganizationName) ? "" : $" — {_license.OrganizationName}")}"
            : DsStrings.LicenseBlocked;
        LicenseText.Foreground = _license.AllowsLocalRun
            ? (System.Windows.Media.Brush)FindResource("DsSuccessBrush")
            : (System.Windows.Media.Brush)FindResource("DsDangerBrush");

        // Now that the server URL is known for certain, check for updates against it, and start the
        // push listener so a release staged later reaches this client without it having to poll.
        _ = CheckForUpdateAsync(_client.BaseUrl, interactive: false);
        await StartUpdateListenerAsync(_client.BaseUrl);

        await LoadProcessesAsync();
    }

    /// <summary>
    /// Attach the SignalR listener that the server pushes new releases to.
    /// </summary>
    /// <remarks>
    /// A push is preferred over polling because the server already knows when it staged a package;
    /// making every client ask on a timer spends their resources to learn something the server could
    /// simply say. The launch-time and manual checks remain as the fallback, so a client that cannot
    /// hold a WebSocket connection (a strict proxy, an older server) still learns of updates.
    /// </remarks>
    private async Task StartUpdateListenerAsync(string serverBase)
    {
        if (_updateListener is not null) return;
        _updateListener = new UpdateListener(serverBase);
        _updateListener.UpdateAvailable += info => Dispatcher.Invoke(() =>
        {
            UpdateStatus.Text = $"نسخهٔ جدید {info.Version} روی سرور موجود است. برای نصب از دکمهٔ به‌روزرسانی استفاده کنید.";
        });
        await _updateListener.StartAsync();
    }

    /// <summary>
    /// Drag the borderless window by its own title bar.
    /// </summary>
    /// <remarks>
    /// WindowChrome is configured with CaptionHeight=0 on purpose (a non-zero caption height would
    /// make WPF treat the bar as system chrome and re-introduce the very hit-testing behaviour we
    /// are replacing). The cost is that dragging has to be wired up by hand.
    /// </remarks>
    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        // Double-click the bar to maximise, matching every other Windows app. Restore from maximised
        // is deliberately not a double-click toggle on the same place only — the standard behaviour
        // is what users expect, so it is mirrored rather than invented.
        if (e.ClickCount == 2)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
            return;
        }
        try { DragMove(); } catch { /* the mouse was released mid-drag; nothing to do */ }
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

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
        LoginStatus.Foreground = (System.Windows.Media.Brush)FindResource("DsDangerBrush");
        LoginStatus.Text = "";
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
        // Every available way to drive a browser is listed, so the user can see that a missing
        // GeckoDriver is not the end of the road — the point of probing rather than assuming.
        var lines = new List<string>();
        foreach (var (_, label, probe) in ExecutionModeProbe.ProbeAll())
            lines.Add($"{(probe.Available ? "✔" : "✖")} {label}\n    {probe.Detail}");

        var anyAvailable = ExecutionModeProbe.ProbeAll().Any(p => p.Probe.Available);
        MessageBox.Show(this,
            string.Join("\n\n", lines),
            anyAvailable ? "روش‌های اجرای موجود" : DsStrings.DriverMissing,
            MessageBoxButton.OK, anyAvailable ? MessageBoxImage.Information : MessageBoxImage.Warning);
    }

    private async void CheckUpdate_Click(object sender, RoutedEventArgs e)
    {
        var url = _client?.BaseUrl ?? ServerAddress.BaseUrl;
        if (string.IsNullOrWhiteSpace(url))
        {
            UpdateStatus.Text = "ابتدا آدرس سرور را وارد کنید.";
            return;
        }
        UpdateStatus.Text = "در حال بررسی…";
        var info = await UpdateService.CheckAsync(url);
        if (info is null)
        {
            UpdateStatus.Text = "سرور در دسترس نبود.";
            return;
        }
        if (!info.Available || !UpdateService.IsNewer(info.Version, UpdateService.CurrentVersion))
        {
            UpdateStatus.Text = $"برنامه به‌روز است (نسخهٔ {UpdateService.CurrentVersion}).";
            return;
        }
        UpdateStatus.Text = "";
        await CheckForUpdateAsync(url, interactive: true);
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
