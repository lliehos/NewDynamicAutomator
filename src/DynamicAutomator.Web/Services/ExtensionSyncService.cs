using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace DynamicAutomator.Web.Services;

/// <summary>
/// Keeps a stable per-user extension folder in sync with the project source.
/// Chrome cannot auto-install unpacked extensions — user loads this path once with
/// Developer Mode; then portal sync + extension polling reloads on change.
/// </summary>
public sealed class ExtensionSyncService : IHostedService, IDisposable
{
    public static readonly string BootId = Guid.NewGuid().ToString("N");

    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly ILogger<ExtensionSyncService> _log;
    private FileSystemWatcher? _watcher;
    private readonly object _gate = new();
    private Timer? _debounce;
    private string _lastStamp = "";
    private string _syncedContentStamp = "";

    public ExtensionSyncService(IWebHostEnvironment env, IConfiguration config, ILogger<ExtensionSyncService> log)
    {
        _env = env;
        _config = config;
        _log = log;
    }

    public string InstallPath { get; private set; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "DynamicAutomator", "extension");

    public string? SourcePath { get; private set; }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        SourcePath = ResolveSourceFolder();
        SyncNow("startup");

        if (_env.IsDevelopment() && !string.IsNullOrEmpty(SourcePath) && Directory.Exists(SourcePath))
        {
            try
            {
                _watcher = new FileSystemWatcher(SourcePath)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName
                                   | NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.CreationTime
                };
                _watcher.Changed += OnSourceChanged;
                _watcher.Created += OnSourceChanged;
                _watcher.Deleted += OnSourceChanged;
                _watcher.Renamed += OnSourceChanged;
                _watcher.EnableRaisingEvents = true;
                _log.LogInformation("Watching extension source for auto-sync: {Path}", SourcePath);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Could not watch extension source folder");
            }
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _watcher?.Dispose();
        _watcher = null;
        _debounce?.Dispose();
        _debounce = null;
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        _watcher?.Dispose();
        _debounce?.Dispose();
    }

    public SyncResult SyncNow(string reason = "manual")
    {
        lock (_gate)
        {
            SourcePath = ResolveSourceFolder();
            if (string.IsNullOrEmpty(SourcePath) || !Directory.Exists(SourcePath))
            {
                return new SyncResult(false, InstallPath, SourcePath, _lastStamp, "منبع افزونه پیدا نشد.");
            }

            var contentStamp = ComputeContentStamp(SourcePath);
            var installReady = Directory.Exists(InstallPath)
                               && System.IO.File.Exists(Path.Combine(InstallPath, "manifest.json"));

            // Skip copy when source unchanged — re-copying would bump mtimes and loop reloads.
            if (installReady && contentStamp == _syncedContentStamp)
            {
                _lastStamp = $"{BootId}:{contentStamp}";
                return new SyncResult(true, InstallPath, SourcePath, _lastStamp, null);
            }

            Directory.CreateDirectory(InstallPath);
            CopyTree(SourcePath, InstallPath);
            _syncedContentStamp = contentStamp;
            _lastStamp = $"{BootId}:{contentStamp}";
            _log.LogInformation("Extension synced ({Reason}) → {Install} stamp={Stamp}", reason, InstallPath, _lastStamp);
            return new SyncResult(true, InstallPath, SourcePath, _lastStamp, null);
        }
    }

    public StampInfo GetStamp(bool syncFirst = true)
    {
        if (syncFirst)
            SyncNow("stamp");
        else if (string.IsNullOrEmpty(_lastStamp))
            _lastStamp = $"{BootId}:{ComputeContentStamp(Directory.Exists(InstallPath) ? InstallPath : (SourcePath ?? InstallPath))}";

        return new StampInfo(_lastStamp, BootId, ReadManifestVersion(InstallPath), InstallPath, SourcePath);
    }

    private void OnSourceChanged(object sender, FileSystemEventArgs e)
    {
        // Ignore editor temp files
        var name = Path.GetFileName(e.Name ?? e.FullPath);
        if (string.IsNullOrEmpty(name) || name.EndsWith("~", StringComparison.Ordinal) || name.StartsWith(".", StringComparison.Ordinal))
            return;

        _debounce?.Dispose();
        _debounce = new Timer(_ =>
        {
            try { SyncNow("watch"); }
            catch (Exception ex) { _log.LogWarning(ex, "Extension sync after watch failed"); }
        }, null, TimeSpan.FromMilliseconds(600), Timeout.InfiniteTimeSpan);
    }

    private string? ResolveSourceFolder()
    {
        var configured = _config["Extension:Path"];
        if (!string.IsNullOrWhiteSpace(configured) && Directory.Exists(configured))
            return Path.GetFullPath(configured);

        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", "..", "extension")),
            Path.GetFullPath(Path.Combine(_env.ContentRootPath, "extension")),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "extension"))
        };
        return candidates.FirstOrDefault(Directory.Exists);
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
            System.IO.File.Copy(file, target, overwrite: true);
        }

        // Remove files in dest that no longer exist in source (keep folder clean)
        foreach (var file in Directory.EnumerateFiles(dest, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(dest, file);
            var src = Path.Combine(source, rel);
            if (!System.IO.File.Exists(src))
            {
                try { System.IO.File.Delete(file); } catch { /* ignore */ }
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
            var ticks = System.IO.File.GetLastWriteTimeUtc(file).Ticks;
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
            if (!System.IO.File.Exists(path)) return "";
            using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(path));
            return doc.RootElement.TryGetProperty("version", out var v) ? (v.GetString() ?? "") : "";
        }
        catch
        {
            return "";
        }
    }

    public readonly record struct SyncResult(bool Ok, string InstallPath, string? SourcePath, string Stamp, string? Error);
    public readonly record struct StampInfo(string Stamp, string BootId, string Version, string InstallPath, string? SourcePath);
}
