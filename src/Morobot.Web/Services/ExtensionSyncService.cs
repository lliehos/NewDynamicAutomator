using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Morobot.Web.Services;

/// <summary>
/// Keeps two per-user extension folders in sync: Recorder and Player.
/// Chrome cannot auto-install unpacked extensions — user loads each path once.
/// </summary>
public sealed class ExtensionSyncService : IHostedService, IDisposable
{
    public static readonly string BootId = Guid.NewGuid().ToString("N");

    public const string RoleRecorder = "recorder";
    public const string RolePlayer = "player";
    public const string RoleSelector = "selector";
    public const string RoleSmart = "smart";

    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly ILogger<ExtensionSyncService> _log;
    private readonly List<FileSystemWatcher> _watchers = new();
    private readonly object _gate = new();
    private Timer? _debounce;
    private readonly Dictionary<string, PackageState> _packages = new(StringComparer.OrdinalIgnoreCase);

    public ExtensionSyncService(IWebHostEnvironment env, IConfiguration config, ILogger<ExtensionSyncService> log)
    {
        _env = env;
        _config = config;
        _log = log;

        // Android-style package folder on the user's machine.
        var baseInstall = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "morobot.soras.ir");
        MigrateLegacyInstallRoot(baseInstall);

        _packages[RoleRecorder] = new PackageState(
            RoleRecorder,
            Path.Combine(baseInstall, "extension-recorder"),
            "extension-recorder");
        _packages[RolePlayer] = new PackageState(
            RolePlayer,
            Path.Combine(baseInstall, "extension-player"),
            "extension-player");
        _packages[RoleSelector] = new PackageState(
            RoleSelector,
            Path.Combine(baseInstall, "extension-selector"),
            "extension-selector");
        _packages[RoleSmart] = new PackageState(
            RoleSmart,
            Path.Combine(baseInstall, "extension-smart-recorder"),
            "extension-smart-recorder");
    }

    /// <summary>
    /// One-time move from legacy %LocalAppData%\DynamicAutomator → morobot.soras.ir
    /// when the new root is empty.
    /// </summary>
    private void MigrateLegacyInstallRoot(string newRoot)
    {
        try
        {
            var legacy = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DynamicAutomator");
            if (!Directory.Exists(legacy)) return;
            Directory.CreateDirectory(newRoot);

            foreach (var name in new[]
                     {
                         "extension-recorder", "extension-player", "extension-selector",
                         "extension-smart-recorder", "extension"
                     })
            {
                var from = Path.Combine(legacy, name);
                var to = Path.Combine(newRoot, name);
                if (!Directory.Exists(from) || Directory.Exists(to)) continue;
                try
                {
                    Directory.Move(from, to);
                    _log.LogInformation("Migrated extension package {Name} → {To}", name, to);
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Could not migrate {From} → {To}", from, to);
                }
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Legacy install-root migration skipped");
        }
    }

    /// <summary>Legacy single-path accessor → recorder (most common install first).</summary>
    public string InstallPath => _packages[RoleRecorder].InstallPath;

    public string? SourcePath => _packages[RoleRecorder].SourcePath;

    public string InstallPathFor(string role) => ResolveRole(role).InstallPath;

    public string? SourcePathFor(string role) => ResolveRole(role).SourcePath;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        foreach (var pkg in _packages.Values)
        {
            pkg.SourcePath = ResolveSourceFolder(pkg.SourceFolderName, pkg.Role);
            SyncPackage(pkg, "startup");

            if (_env.IsDevelopment() && !string.IsNullOrEmpty(pkg.SourcePath) && Directory.Exists(pkg.SourcePath))
            {
                try
                {
                    var watcher = new FileSystemWatcher(pkg.SourcePath)
                    {
                        IncludeSubdirectories = true,
                        NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName
                                       | NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.CreationTime
                    };
                    var role = pkg.Role;
                    watcher.Changed += (_, e) => OnSourceChanged(role, e);
                    watcher.Created += (_, e) => OnSourceChanged(role, e);
                    watcher.Deleted += (_, e) => OnSourceChanged(role, e);
                    watcher.Renamed += (_, e) => OnSourceChanged(role, e);
                    watcher.EnableRaisingEvents = true;
                    _watchers.Add(watcher);
                    _log.LogInformation("Watching {Role} extension source: {Path}", pkg.Role, pkg.SourcePath);
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Could not watch {Role} extension source", pkg.Role);
                }
            }
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        foreach (var w in _watchers) w.Dispose();
        _watchers.Clear();
        _debounce?.Dispose();
        _debounce = null;
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        foreach (var w in _watchers) w.Dispose();
        _watchers.Clear();
        _debounce?.Dispose();
    }

    public SyncResult SyncNow(string reason = "manual")
    {
        lock (_gate)
        {
            SyncResult? last = null;
            foreach (var pkg in _packages.Values)
            {
                last = SyncPackage(pkg, reason);
            }
            return last ?? new SyncResult(false, InstallPath, SourcePath, "", "هیچ بسته‌ای تعریف نشده.");
        }
    }

    public SyncResult SyncRole(string role, string reason = "manual")
    {
        lock (_gate)
        {
            return SyncPackage(ResolveRole(role), reason);
        }
    }

    public StampInfo GetStamp(bool syncFirst = true) => GetStamp(RoleRecorder, syncFirst);

    public StampInfo GetStamp(string role, bool syncFirst = true)
    {
        var pkg = ResolveRole(role);
        if (syncFirst)
            SyncRole(pkg.Role, "stamp");
        else if (string.IsNullOrEmpty(pkg.LastStamp))
            pkg.LastStamp = $"{BootId}:{ComputeContentStamp(Directory.Exists(pkg.InstallPath) ? pkg.InstallPath : (pkg.SourcePath ?? pkg.InstallPath))}";

        return new StampInfo(pkg.LastStamp, BootId, ReadManifestVersion(pkg.InstallPath), pkg.InstallPath, pkg.SourcePath, pkg.Role);
    }

    public object InstallPathsPayload()
    {
        SyncNow("install-path");
        var recorder = Snapshot(RoleRecorder);
        var player = Snapshot(RolePlayer);
        var selector = Snapshot(RoleSelector);
        var smart = Snapshot(RoleSmart);
        return new
        {
            ok = recorder.Ok && player.Ok && selector.Ok && smart.Ok,
            recorder,
            player,
            selector,
            smart,
            // Back-compat single fields → recorder
            path = recorder.Path,
            source = recorder.Source,
            stamp = recorder.Stamp,
            version = recorder.Version,
            error = recorder.Error ?? player.Error ?? selector.Error ?? smart.Error,
            hint = "چهار افزونه: Recorder، Player، Selector، Smart Recorder. هر کدام را یک‌بار Load unpacked کنید."
        };
    }

    private PackageSnapshot Snapshot(string role)
    {
        var pkg = ResolveRole(role);
        var ok = Directory.Exists(pkg.InstallPath) && File.Exists(Path.Combine(pkg.InstallPath, "manifest.json"));
        var (name, title, description) = pkg.Role switch
        {
            RolePlayer => ("Morobot Player", "افزونهٔ اجرا", "برای اجرای فرآیند، توقف و پاز لازم است."),
            RoleSelector => ("Morobot Selector", "افزونهٔ سلکتور", "راست‌کلیک روی عنصر → کپی سلکتور به حافظه برای ویرایشگر."),
            RoleSmart => ("Morobot Smart Recorder", "افزونهٔ هوشمندسازی", "کانتکس تعاملات را برای یادگیری بعدی به سرور می‌فرستد."),
            _ => ("Morobot Recorder", "افزونهٔ ضبط", "برای شروع/اتمام ضبط و ذخیرهٔ فرآیند لازم است.")
        };
        return new PackageSnapshot(
            ok,
            pkg.Role,
            pkg.InstallPath,
            pkg.SourcePath,
            pkg.LastStamp,
            ReadManifestVersion(pkg.InstallPath),
            name,
            title,
            description,
            ok ? null : "پوشهٔ نصب آماده نیست."
        );
    }

    private PackageState ResolveRole(string? role)
    {
        var key = string.IsNullOrWhiteSpace(role) ? RoleRecorder : role.Trim().ToLowerInvariant();
        if (key is "play" or "player") key = RolePlayer;
        if (key is "record" or "recorder" or "rec") key = RoleRecorder;
        if (key is "sel" or "selector" or "pick" or "context") key = RoleSelector;
        if (key is "smart" or "smart-recorder" or "smartrecorder" or "ai" or "learn") key = RoleSmart;
        if (!_packages.TryGetValue(key, out var pkg))
            throw new ArgumentException($"Unknown extension role: {role}");
        return pkg;
    }

    private SyncResult SyncPackage(PackageState pkg, string reason)
    {
        pkg.SourcePath = ResolveSourceFolder(pkg.SourceFolderName, pkg.Role);
        if (string.IsNullOrEmpty(pkg.SourcePath) || !Directory.Exists(pkg.SourcePath))
        {
            return new SyncResult(false, pkg.InstallPath, pkg.SourcePath, pkg.LastStamp, $"منبع {pkg.Role} پیدا نشد.");
        }

        var contentStamp = ComputeContentStamp(pkg.SourcePath);
        var installReady = Directory.Exists(pkg.InstallPath)
                           && File.Exists(Path.Combine(pkg.InstallPath, "manifest.json"));

        if (installReady && contentStamp == pkg.SyncedContentStamp)
        {
            pkg.LastStamp = $"{BootId}:{contentStamp}";
            return new SyncResult(true, pkg.InstallPath, pkg.SourcePath, pkg.LastStamp, null);
        }

        Directory.CreateDirectory(pkg.InstallPath);
        CopyTree(pkg.SourcePath, pkg.InstallPath);
        pkg.SyncedContentStamp = contentStamp;
        pkg.LastStamp = $"{BootId}:{contentStamp}";
        _log.LogInformation("{Role} extension synced ({Reason}) → {Install} stamp={Stamp}",
            pkg.Role, reason, pkg.InstallPath, pkg.LastStamp);
        return new SyncResult(true, pkg.InstallPath, pkg.SourcePath, pkg.LastStamp, null);
    }

    private void OnSourceChanged(string role, FileSystemEventArgs e)
    {
        var name = Path.GetFileName(e.Name ?? e.FullPath);
        if (string.IsNullOrEmpty(name) || name.EndsWith("~", StringComparison.Ordinal) || name.StartsWith(".", StringComparison.Ordinal))
            return;

        _debounce?.Dispose();
        _debounce = new Timer(_ =>
        {
            try { SyncRole(role, "watch"); }
            catch (Exception ex) { _log.LogWarning(ex, "Extension sync after watch failed ({Role})", role); }
        }, null, TimeSpan.FromMilliseconds(600), Timeout.InfiniteTimeSpan);
    }

    private string? ResolveSourceFolder(string folderName, string role)
    {
        var configKey = role switch
        {
            RolePlayer => "Extension:PlayerPath",
            RoleSelector => "Extension:SelectorPath",
            RoleSmart => "Extension:SmartPath",
            _ => "Extension:RecorderPath"
        };
        var configured = _config[configKey] ?? (role == RoleRecorder ? _config["Extension:Path"] : null);
        if (!string.IsNullOrWhiteSpace(configured) && Directory.Exists(configured))
            return Path.GetFullPath(configured);

        var candidates = new List<string>
        {
            Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", "..", folderName)),
            Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", folderName)),
            Path.GetFullPath(Path.Combine(_env.ContentRootPath, folderName)),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", folderName)),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", folderName)),
            Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), folderName)),
            Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", folderName)),
            Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", folderName))
        };

        // Walk up from ContentRoot looking for repo-root/<folderName>
        try
        {
            var dir = new DirectoryInfo(_env.ContentRootPath);
            for (var i = 0; i < 6 && dir != null; i++, dir = dir.Parent)
            {
                candidates.Add(Path.Combine(dir.FullName, folderName));
            }
        }
        catch { /* ignore */ }

        return candidates
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(Directory.Exists);
    }

    private static void CopyTree(string source, string dest)
    {
        foreach (var dir in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(source, dir);
            Directory.CreateDirectory(Path.Combine(dest, rel));
        }

        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var name = Path.GetFileName(file);
            if (name.StartsWith(".", StringComparison.Ordinal)) continue;
            var rel = Path.GetRelativePath(source, file);
            var target = Path.Combine(dest, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: true);
        }

        foreach (var file in Directory.EnumerateFiles(dest, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(dest, file);
            var src = Path.Combine(source, rel);
            if (!File.Exists(src))
            {
                try { File.Delete(file); } catch { /* ignore */ }
            }
        }
    }

    private static string ComputeContentStamp(string folder)
    {
        if (!Directory.Exists(folder)) return "empty";

        long maxTicks = 0;
        var sb = new StringBuilder();
        foreach (var file in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories)
                     .OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
        {
            var name = Path.GetFileName(file);
            if (name.StartsWith(".", StringComparison.Ordinal)) continue;
            var ticks = File.GetLastWriteTimeUtc(file).Ticks;
            if (ticks > maxTicks) maxTicks = ticks;
            sb.Append(Path.GetRelativePath(folder, file).Replace('\\', '/'))
              .Append(':').Append(ticks).Append(';');
        }

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString())))[..16];
        return $"{maxTicks}:{hash}";
    }

    private static string ReadManifestVersion(string folder)
    {
        try
        {
            var path = Path.Combine(folder, "manifest.json");
            if (!File.Exists(path)) return "";
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            return doc.RootElement.TryGetProperty("version", out var v) ? (v.GetString() ?? "") : "";
        }
        catch
        {
            return "";
        }
    }

    private sealed class PackageState
    {
        public PackageState(string role, string installPath, string sourceFolderName)
        {
            Role = role;
            InstallPath = installPath;
            SourceFolderName = sourceFolderName;
        }

        public string Role { get; }
        public string InstallPath { get; }
        public string SourceFolderName { get; }
        public string? SourcePath { get; set; }
        public string LastStamp { get; set; } = "";
        public string SyncedContentStamp { get; set; } = "";
    }

    public readonly record struct SyncResult(bool Ok, string InstallPath, string? SourcePath, string Stamp, string? Error);
    public readonly record struct StampInfo(string Stamp, string BootId, string Version, string InstallPath, string? SourcePath, string Role = RoleRecorder);
    public readonly record struct PackageSnapshot(
        bool Ok,
        string Role,
        string Path,
        string? Source,
        string Stamp,
        string Version,
        string Name,
        string Title,
        string Description,
        string? Error);
}
