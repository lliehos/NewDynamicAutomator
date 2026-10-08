using System.IO.Compression;
using Microsoft.AspNetCore.SignalR;
using Webautomator.Web.Hubs;

namespace Webautomator.Web.Services;

/// <summary>
/// Stages and publishes the desktop player, so a server publish also ships the player.
/// </summary>
/// <remarks>
/// The desktop app is the same kind of artefact as the browser extension: a client the panel hands
/// out and later replaces. It therefore follows the extension's model deliberately — a source
/// folder that publish copies next to the app, a staged package under <c>App_Data/desktop</c>, a
/// version read from the staged build, and a push when it changes — rather than inventing a second
/// distribution mechanism that would need its own maintenance.
///
/// The one difference is the direction of the version: an extension's version lives in its
/// manifest.json, while the player is a compiled binary, so its version comes from the
/// <c>version.txt</c> written beside the staged build at publish time.
/// </remarks>
public class DesktopSyncService : IHostedService
{
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;
    private readonly IHubContext<CatalogHub> _hub;
    private readonly ILogger<DesktopSyncService> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>Per-process id, so a server restart alone is visible as a change to a poller.</summary>
    public static readonly string BootId = Guid.NewGuid().ToString("N");

    public DesktopSyncService(
        IWebHostEnvironment env,
        IConfiguration config,
        IHubContext<CatalogHub> hub,
        ILogger<DesktopSyncService> log)
    {
        _env = env;
        _config = config;
        _hub = hub;
        _log = log;
    }

    /// <summary>Where the staged package lives, under the app's own content root.</summary>
    public string StageRoot => Path.Combine(_env.ContentRootPath, "App_Data", "desktop");

    public string PackagePath => Path.Combine(StageRoot, "package.zip");
    public string VersionFilePath => Path.Combine(StageRoot, "version.txt");
    public string NotesFilePath => Path.Combine(StageRoot, "notes.txt");

    /// <summary>The staged build's version, or null when nothing has been staged.</summary>
    public string? StagedVersion
    {
        get
        {
            try
            {
                return File.Exists(VersionFilePath) ? File.ReadAllText(VersionFilePath).Trim() : null;
            }
            catch { return null; }
        }
    }

    public bool HasPackage
    {
        get { try { return File.Exists(PackagePath); } catch { return false; } }
    }

    /// <summary>
    /// Find the published player folder, mirroring how the extension source is located so a
    /// deployment behaves the same way for both clients.
    /// </summary>
    public string? ResolveSourceFolder()
    {
        var configured = _config["Desktop:Path"] ?? _config["Desktop:SourcePath"];
        if (!string.IsNullOrWhiteSpace(configured) && Directory.Exists(configured))
            return Path.GetFullPath(configured);

        const string folderName = "desktop";
        var candidates = new List<string>
        {
            Path.Combine(_env.ContentRootPath, folderName),
            Path.Combine(_env.ContentRootPath, "..", folderName),
            Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", "..", folderName))
        };
        try
        {
            var dir = new DirectoryInfo(_env.ContentRootPath);
            for (var i = 0; i < 6 && dir is not null; i++, dir = dir.Parent)
                candidates.Add(Path.Combine(dir.FullName, "publish-desktop"));
        }
        catch { /* a missing folder is handled by the caller */ }

        return candidates.Distinct(StringComparer.OrdinalIgnoreCase).FirstOrDefault(Directory.Exists);
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        // Development only: a file watcher on the source folder makes a rebuilt player appear on the
        // server without a manual step. In Production the publish copy is the source of truth, and
        // watching it would only re-read what was just placed there.
        if (_env.IsDevelopment())
        {
            try
            {
                var src = ResolveSourceFolder();
                if (src is not null)
                {
                    var watcher = new FileSystemWatcher(src) { IncludeSubdirectories = true, EnableRaisingEvents = true };
                    FileSystemEventHandler handler = (_, _) => _ = SyncAndNotifyAsync("file-change");
                    watcher.Changed += handler;
                    watcher.Created += handler;
                    watcher.Renamed += (_, _) => _ = SyncAndNotifyAsync("file-rename");
                    _watchers.Add(watcher);
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Desktop source watcher could not be attached");
            }
        }
        _ = SyncAndNotifyAsync("startup");
        return Task.CompletedTask;
    }

    private readonly List<FileSystemWatcher> _watchers = new();

    public Task StopAsync(CancellationToken cancellationToken)
    {
        foreach (var w in _watchers)
        {
            try { w.Dispose(); } catch { /* shutting down anyway */ }
        }
        _watchers.Clear();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Re-stage the package if the source changed, and tell connected players when it did.
    /// </summary>
    public async Task SyncAndNotifyAsync(string reason)
    {
        // One sync at a time: a file watcher can fire several times for one save, and two concurrent
        // copies into the same staging file would corrupt the zip.
        await _gate.WaitAsync();
        try
        {
            var changed = await SyncAsync(reason);
            if (!changed) return;
            await _hub.Clients.Group(CatalogHub.DesktopPlayersGroup).SendAsync("desktopVersion", new
            {
                version = StagedVersion ?? "0.0.0",
                available = HasPackage,
                downloadUrl = HasPackage ? "/desktop/download" : null,
                notes = ReadNotes(),
                stagedUtc = DateTime.UtcNow.ToString("O")
            });
            // The admin copy is informational; awaiting it would make a slow admin client delay the
            // players' notification, so it is dispatched and observed rather than awaited.
            _ = _hub.Clients.Group(CatalogHub.AdminGroup).SendAsync("desktopVersion", new
            {
                version = StagedVersion ?? "0.0.0",
                available = HasPackage,
                reason
            });
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Desktop package sync failed ({Reason})", reason);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Copy the published player into the staging folder when it differs. Returns true when the
    /// staged package changed, which is what makes the caller broadcast.
    /// </summary>
    private async Task<bool> SyncAsync(string reason)
    {
        var src = ResolveSourceFolder();
        if (src is null) return false;

        var versionFile = Path.Combine(src, "version.txt");
        var version = File.Exists(versionFile) ? File.ReadAllText(versionFile).Trim() : "";
        if (string.IsNullOrWhiteSpace(version))
        {
            // No version means no way to tell a client whether it is behind, so a package without
            // one is not publishable — silently staging it would make every player think it is
            // up to date.
            _log.LogWarning("Desktop source has no version.txt; nothing staged ({Source})", src);
            return false;
        }

        Directory.CreateDirectory(StageRoot);

        var previous = StagedVersion;
        var sameVersion = string.Equals(previous, version, StringComparison.Ordinal);

        // Rebuild the zip from the source folder every time the version changes. Copying only when
        // the version differs keeps a publish cheap, while still letting a same-version re-publish
        // refresh the package when the operator deletes version.txt first.
        var needsRebuild = !sameVersion || !HasPackage;
        if (!needsRebuild) return false;

        var staging = Path.Combine(Path.GetTempPath(), "webautomator-desktop-stage", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            // Build the zip in a temp file and only then move it into place: a client downloading
            // mid-copy must never see a half-written package.
            var zipTemp = Path.Combine(staging, "package.zip");
            using (var zip = ZipFile.Open(zipTemp, ZipArchiveMode.Create))
            {
                foreach (var file in Directory.EnumerateFiles(src, "*", SearchOption.AllDirectories))
                {
                    var rel = Path.GetRelativePath(src, file).Replace('\\', '/');
                    // version.txt/notes.txt belong to the staging convention, not the payload.
                    if (rel.Equals("version.txt", StringComparison.OrdinalIgnoreCase)
                        || rel.Equals("notes.txt", StringComparison.OrdinalIgnoreCase)) continue;
                    zip.CreateEntryFromFile(file, rel, CompressionLevel.Optimal);
                }
            }
            File.Copy(zipTemp, PackagePath, overwrite: true);
            await File.WriteAllTextAsync(VersionFilePath, version);
            var notesSrc = Path.Combine(src, "notes.txt");
            if (File.Exists(notesSrc)) File.Copy(notesSrc, NotesFilePath, overwrite: true);
            else if (File.Exists(NotesFilePath)) File.Delete(NotesFilePath);
        }
        finally
        {
            try { Directory.Delete(staging, recursive: true); } catch { /* temp cleanup is best effort */ }
        }

        _log.LogInformation("Desktop package staged: version {Version} ({Reason})", version, reason);
        return true;
    }

    public string? ReadNotes()
    {
        try { return File.Exists(NotesFilePath) ? File.ReadAllText(NotesFilePath).Trim() : null; }
        catch { return null; }
    }

    /// <summary>The version payload, in the shape both the HTTP endpoint and the push use.</summary>
    public object VersionPayload() => new
    {
        role = "desktop",
        version = StagedVersion ?? "0.0.0",
        available = HasPackage,
        downloadUrl = HasPackage ? "/desktop/download" : null,
        notes = ReadNotes(),
        bootId = BootId,
        apiVersion = 1
    };
}
