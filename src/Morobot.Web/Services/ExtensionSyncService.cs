using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Morobot.Web.Services;

/// <summary>
/// Keeps Morobot Global + Smart Recorder extension folders in sync.
/// Chrome cannot auto-install unpacked extensions — user loads each path once.
/// </summary>
public sealed class ExtensionSyncService : IHostedService, IDisposable
{
    public static readonly string BootId = Guid.NewGuid().ToString("N");

    public const string RoleGlobal = "global";
    public const string RoleRecorder = "recorder";
    public const string RolePlayer = "player";
    public const string RoleSelector = "selector";
    public const string RoleSmart = "smart";

    private const string GlobalFolder = "extension-global";
    private const string GlobalInstallFolder = "extension-global";

    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly ILogger<ExtensionSyncService> _log;
    private readonly IServiceScopeFactory _scopes;
    private readonly DatabaseSetupState _dbSetup;
    private readonly List<FileSystemWatcher> _watchers = new();
    private readonly object _gate = new();
    private Timer? _debounce;
    private readonly Dictionary<string, PackageState> _packages = new(StringComparer.OrdinalIgnoreCase);
    private readonly DeploymentFingerprintService _fingerprints;

    public ExtensionSyncService(
        IWebHostEnvironment env,
        IConfiguration config,
        ILogger<ExtensionSyncService> log,
        IServiceScopeFactory scopes,
        DatabaseSetupState dbSetup,
        DeploymentFingerprintService fingerprints)
    {
        _env = env;
        _config = config;
        _log = log;
        _scopes = scopes;
        _dbSetup = dbSetup;
        _fingerprints = fingerprints;

        var appKey = ExtensionInstallPathHelper.ResolveAppInstanceKey(_config);
        var baseInstall = ExtensionInstallPathHelper.InstanceRoot(_config);
        MigrateLegacyInstallRoot(baseInstall, appKey);
        MigratePreviousBrandRoot(baseInstall, appKey);
        MigrateDefaultKeyFolder(baseInstall, appKey);

        _packages[RoleGlobal] = new PackageState(
            RoleGlobal,
            Path.Combine(baseInstall, GlobalInstallFolder),
            GlobalFolder);
        _packages[RoleRecorder] = _packages[RoleGlobal];
        _packages[RolePlayer] = _packages[RoleGlobal];
        _packages[RoleSelector] = _packages[RoleGlobal];
        _packages[RoleSmart] = new PackageState(
            RoleSmart,
            Path.Combine(baseInstall, "extension-smart-recorder"),
            "extension-smart-recorder");
    }

    /// <summary>
    /// Migrates legacy flat folders into the instance folder
    /// (`webautomator\{AppInstanceKey}\…`, or `webautomator\…` when no key is set).
    /// </summary>
    private void MigrateLegacyInstallRoot(string instanceRoot, string appKey)
    {
        try
        {
            var brandRoot = ExtensionInstallPathHelper.BrandRoot;
            Directory.CreateDirectory(instanceRoot);

            foreach (var name in new[]
                     {
                         GlobalInstallFolder, "extension-smart-recorder",
                         "extension-recorder", "extension-player", "extension-selector"
                     })
            {
                var fromFlat = Path.Combine(brandRoot, name);
                var to = Path.Combine(instanceRoot, name);
                // With no explicit key the root IS the instance folder, so the move is a no-op.
                if (string.Equals(fromFlat, to, StringComparison.OrdinalIgnoreCase)) continue;
                if (Directory.Exists(fromFlat) && !Directory.Exists(to))
                {
                    try
                    {
                        Directory.Move(fromFlat, to);
                        _log.LogInformation("Migrated flat extension {Name} → {To}", name, to);
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "Could not migrate flat {From} → {To}", fromFlat, to);
                    }
                }
            }

            var legacy = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DynamicAutomator");
            if (!Directory.Exists(legacy)) return;

            foreach (var name in new[]
                     {
                         GlobalInstallFolder, "extension-smart-recorder",
                         "extension-recorder", "extension-player", "extension-selector"
                     })
            {
                var from = Path.Combine(legacy, name);
                var to = Path.Combine(instanceRoot, name);
                if (!Directory.Exists(from) || Directory.Exists(to)) continue;
                try
                {
                    Directory.Move(from, to);
                    _log.LogInformation("Migrated DynamicAutomator extension {Name} → {To}", name, to);
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

    /// <summary>
    /// Move packages from the PRE-RENAME product folder into the current brand root.
    ///
    /// Existing installs were loaded by Chrome from `…\morobot.soras.ir\…`; after the folder was
    /// renamed to `webautomator` that path is no longer written by sync, so the user's loaded
    /// extension would silently stop receiving updates. Handles every layout seen in the field:
    /// keyed (`{old}\{key}\extension-global`), flat (`{old}\extension-global`) and the old shared
    /// `default` key. Only moved when the target is free, so nothing is ever merged or overwritten.
    /// </summary>
    private void MigratePreviousBrandRoot(string instanceRoot, string appKey)
    {
        try
        {
            var prevRoot = ExtensionInstallPathHelper.PreviousBrandRoot;
            if (!Directory.Exists(prevRoot)) return;
            Directory.CreateDirectory(instanceRoot);
            var names = new[]
            {
                GlobalInstallFolder, "extension-smart-recorder",
                "extension-recorder", "extension-player", "extension-selector"
            };
            foreach (var name in names)
            {
                var sources = new List<string>
                {
                    Path.Combine(prevRoot, appKey, name),
                    Path.Combine(prevRoot, name)
                };
                if (!string.Equals(appKey, "default", StringComparison.OrdinalIgnoreCase))
                    sources.Add(Path.Combine(prevRoot, "default", name));

                var dst = Path.Combine(instanceRoot, name);
                if (Directory.Exists(dst)) continue;
                var src = sources.FirstOrDefault(Directory.Exists);
                if (src is null) continue;
                try
                {
                    Directory.Move(src, dst);
                    _log.LogInformation("Migrated pre-rename extension {Name} → {To}", name, dst);
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Could not migrate pre-rename {From} → {To}", src, dst);
                }
            }

            // The old root only existed to hold these packages; remove it once it is empty so the
            // path the user was told to abandon does not linger and look loadable.
            TryRemoveEmptyDir(Path.Combine(prevRoot, appKey));
            TryRemoveEmptyDir(prevRoot);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Pre-rename extension migration skipped");
        }
    }

    private static void TryRemoveEmptyDir(string dir)
    {
        try
        {
            if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any())
                Directory.Delete(dir);
        }
        catch { /* ignore */ }
    }

    /// <summary>
    /// Fold the old `default` key folder into wherever packages live now.
    ///
    /// Two shapes exist in the field: installs from when the key was always materialised
    /// (`…\webautomator\default\extension-global`) — the normal case now has no key level at all,
    /// so those move up into the root — and installs from before the identity key (`…\default\…`)
    /// on a deployment that HAS since set a key, which move down into the key folder. One rule,
    /// both directions; only moved when the target is free.
    /// </summary>
    private void MigrateDefaultKeyFolder(string instanceRoot, string appKey)
    {
        try
        {
            var from = Path.Combine(ExtensionInstallPathHelper.BrandRoot, "default");
            if (!Directory.Exists(from)) return;
            Directory.CreateDirectory(instanceRoot);
            foreach (var name in new[]
                     {
                         GlobalInstallFolder, "extension-smart-recorder",
                         "extension-recorder", "extension-player", "extension-selector"
                     })
            {
                var src = Path.Combine(from, name);
                var dst = Path.Combine(instanceRoot, name);
                if (!Directory.Exists(src) || Directory.Exists(dst)) continue;
                try
                {
                    Directory.Move(src, dst);
                    _log.LogInformation("Migrated default-key extension {Name} → {To}", name, dst);
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Could not migrate default-key {From} → {To}", src, dst);
                }
            }

            TryRemoveEmptyDir(from);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Default-key extension migration skipped");
        }
    }

    public string AppInstanceKey => ExtensionInstallPathHelper.ResolveAppInstanceKey(_config);

    /// <summary>Legacy single-path accessor → recorder (most common install first).</summary>
    public string InstallPath => _packages[RoleRecorder].InstallPath;

    public string? SourcePath => _packages[RoleRecorder].SourcePath;

    public string InstallPathFor(string role) => ResolveRole(role).InstallPath;

    public string? SourcePathFor(string role) => ResolveRole(role).SourcePath;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        foreach (var pkg in _packages.Values.Distinct())
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
            last = SyncPackage(_packages[RoleGlobal], reason);
            last = SyncPackage(_packages[RoleSmart], reason);
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

    public object InstallPathsPayload(object? branding = null)
    {
        SyncNow("install-path");
        var global = Snapshot(RoleGlobal);
        var smart = Snapshot(RoleSmart);
        var fp = _fingerprints.TryGet();
        // Manifest names are "<Brand> Global"; strip the role suffix to recover the brand.
        var brandName = (global.Name ?? "").Trim();
        if (brandName.EndsWith(" Global", StringComparison.OrdinalIgnoreCase))
            brandName = brandName[..^" Global".Length].Trim();
        if (string.IsNullOrWhiteSpace(brandName)) brandName = "Morobot";
        return new
        {
            ok = global.Ok && smart.Ok,
            global,
            recorder = global with { Role = RoleRecorder },
            player = global with { Role = RolePlayer },
            selector = global with { Role = RoleSelector },
            smart,
            path = global.Path,
            source = global.Source,
            stamp = global.Stamp,
            version = global.Version,
            fingerprint = fp?.Fingerprint,
            instanceId = fp?.InstanceId,
            error = global.Error ?? smart.Error,
            appInstanceKey = AppInstanceKey,
            instanceRoot = ExtensionInstallPathHelper.InstanceRoot(_config),
            hint = $"دو افزونه: {brandName} Global (ضبط + اجرا + سلکتور) و Smart Recorder. پیوند افزونه ↔ سرور با اثر انگشت همین استقرار انجام می‌شود؛ کلید AppInstanceKey فقط وقتی لازم است که چند استقرار روی یک PC باشند.",
            branding
        };
    }

    private PackageSnapshot Snapshot(string role)
    {
        var pkg = ResolveRole(role);
        var ok = Directory.Exists(pkg.InstallPath) && File.Exists(Path.Combine(pkg.InstallPath, "manifest.json"));
        var (name, title, description) = ReadExtensionBrandingMeta(pkg.InstallPath, pkg.Role);
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

    private static (string Name, string Title, string Description) ReadExtensionBrandingMeta(string installPath, string role)
    {
        var defaults = role switch
        {
            RoleSmart => ("Smart Recorder", "افزونهٔ هوشمندسازی", "کانتکس تعاملات برای یادگیری بعدی."),
            _ => ("Global", "افزونهٔ اتوماسیون", "ضبط، اجرا و سلکتور — یک افزونه.")
        };

        try
        {
            var path = Path.Combine(installPath, "morobot-branding.json");
            if (!File.Exists(path)) return defaults;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var app = root.TryGetProperty("appName", out var a) ? a.GetString() : null;
            var extName = root.TryGetProperty("extensionName", out var e) ? e.GetString() : null;
            var brandTitle = root.TryGetProperty("brandTitle", out var t) ? t.GetString() : null;
            if (string.IsNullOrWhiteSpace(app)) return defaults;
            var name = string.IsNullOrWhiteSpace(extName)
                ? (role == RoleSmart ? $"{app} Smart Recorder" : $"{app} Global")
                : extName;
            var title = string.IsNullOrWhiteSpace(brandTitle) ? defaults.Item2 : brandTitle;
            var desc = role == RoleSmart
                ? $"{title} — Smart Recorder"
                : $"{title} — ضبط، اجرا و سلکتور";
            return (name, title, desc);
        }
        catch
        {
            return defaults;
        }
    }

    private PackageState ResolveRole(string? role)
    {
        var key = string.IsNullOrWhiteSpace(role) ? RoleRecorder : role.Trim().ToLowerInvariant();
        if (key is "play" or "player") key = RolePlayer;
        if (key is "record" or "recorder" or "rec" or "global") key = RoleGlobal;
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
            TryApplyBrandingOverlay();
            TryWriteBindingFile(pkg);
            return new SyncResult(true, pkg.InstallPath, pkg.SourcePath, pkg.LastStamp, null);
        }

        Directory.CreateDirectory(pkg.InstallPath);
        CopyTree(pkg.SourcePath, pkg.InstallPath);
        pkg.SyncedContentStamp = contentStamp;
        pkg.LastStamp = $"{BootId}:{contentStamp}";
        _log.LogInformation("{Role} extension synced ({Reason}) → {Install} stamp={Stamp}",
            pkg.Role, reason, pkg.InstallPath, pkg.LastStamp);
        TryApplyBrandingOverlay();
        TryWriteBindingFile(pkg);
        return new SyncResult(true, pkg.InstallPath, pkg.SourcePath, pkg.LastStamp, null);
    }

    private void TryApplyBrandingOverlay()
    {
        // The overlay reads branding from SystemSettings, which does not exist until migrations have
        // run. This method is reached from StartAsync — a hosted service starts as soon as the host
        // does, which is now *before* initialisation, because that was moved off the startup path to
        // let the progress page be served. Sync itself is pure file copying and still runs; only the
        // database-backed overlay is deferred. The initialiser applies the overlay once it is ready.
        if (!_dbSetup.IsReady)
        {
            _log.LogDebug("Extension branding overlay deferred until startup initialisation completes.");
            return;
        }

        try
        {
            using var scope = _scopes.CreateScope();
            var overlay = scope.ServiceProvider.GetRequiredService<ExtensionBrandingOverlay>();
            overlay.ApplyAllPackagesAsync(this).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Extension branding overlay skipped");
        }
    }

    /// <summary>
    /// Write <c>morobot-binding.json</c> into an install folder.
    ///
    /// This file is the extension's half of the server binding: it carries the deployment
    /// fingerprint the extension compares against every portal origin it meets. Without it the
    /// extension falls back to the old "any Morobot-looking portal" behaviour; with it, an extension
    /// loaded from THIS folder only ever answers THIS server. Written per install root (global and
    /// smart) and exempt from the copy-tree cleanup, exactly like the branding overlay file.
    /// </summary>
    private void TryWriteBindingFile(PackageState pkg)
    {
        try
        {
            var fp = _fingerprints.TryGet();
            if (fp is null || !Directory.Exists(pkg.InstallPath)) return;
            var payload = new
            {
                v = 1,
                appInstanceKey = fp.AppInstanceKey,
                instanceId = fp.InstanceId,
                fingerprint = fp.Fingerprint,
                generatedAtUtc = DateTime.UtcNow.ToString("O")
            };
            var json = System.Text.Json.JsonSerializer.Serialize(payload,
                new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(Path.Combine(pkg.InstallPath, "morobot-binding.json"), json);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Extension binding file skipped for {Role}", pkg.Role);
        }
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
            RoleSmart => "Extension:SmartPath",
            RolePlayer or RoleSelector => "Extension:GlobalPath",
            _ => "Extension:GlobalPath"
        };
        var configured = _config[configKey]
                         ?? _config["Extension:RecorderPath"]
                         ?? _config["Extension:PlayerPath"]
                         ?? _config["Extension:SelectorPath"]
                         ?? (role == RoleGlobal || role == RoleRecorder ? _config["Extension:Path"] : null);
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
            if (rel.Equals("morobot-branding.json", StringComparison.OrdinalIgnoreCase)) continue;
            if (rel.Equals("morobot-binding.json", StringComparison.OrdinalIgnoreCase)) continue;
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
