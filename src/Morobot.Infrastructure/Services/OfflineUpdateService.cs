using System.IO.Compression;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Morobot.Infrastructure.Options;

namespace Morobot.Infrastructure.Services;

/// <summary>Result of validating or staging an uploaded offline update package.</summary>
public sealed record OfflineUpdateStatus
{
    public bool Uploaded { get; init; }
    public bool Staged { get; init; }
    public string? Version { get; init; }
    public string? Notes { get; init; }
    public string? UploadedUtc { get; init; }
    public string? ArchivePath { get; init; }
    public string? StagedPath { get; init; }
    public string? UpdaterScript { get; init; }
    public string? Error { get; init; }
}

/// <summary>
/// Accepts an offline update archive, verifies it against its own manifest, and extracts it
/// into a staging folder the operator (or the restart helper) can apply.
/// </summary>
/// <remarks>
/// An air-gapped install has no feed to poll, so the package has to carry everything needed
/// to trust it: the target version, the minimum version it may be applied over, and the
/// SHA-256 of every payload file. Each of those is checked here before a single file is
/// written outside the staging folder, because a half-extracted update is worse than a
/// rejected one — the running app would have a mixture of two versions on disk.
/// </remarks>
public sealed class OfflineUpdateService
{
    private readonly OfflineUpdateOptions _options;
    private readonly ILogger<OfflineUpdateService> _log;
    private readonly string _contentRoot;

    public OfflineUpdateService(
        IOptions<OfflineUpdateOptions> options,
        ILogger<OfflineUpdateService> log)
        : this(options, AppContext.BaseDirectory, log)
    {
    }

    /// <summary>
    /// Uses <paramref name="contentRoot"/> to turn the configured relative folders into
    /// absolute ones. The caller supplies it (the web host knows its content root) so this
    /// service stays usable outside a hosted process, e.g. from a maintenance command.
    /// </summary>
    public OfflineUpdateService(
        IOptions<OfflineUpdateOptions> options,
        string contentRoot,
        ILogger<OfflineUpdateService> log)
    {
        _options = options.Value;
        _log = log;
        _contentRoot = contentRoot;
    }

    public string UploadDirectory => Resolve(_options.UploadDirectory);
    public string StagingDirectory => Resolve(_options.StagingDirectory);

    /// <summary>The archive kept for the currently staged version, if any.</summary>
    public string? CurrentArchivePath()
    {
        var dir = UploadDirectory;
        if (!Directory.Exists(dir)) return null;
        var latest = new DirectoryInfo(dir).GetFiles("*.zip")
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .FirstOrDefault();
        return latest?.FullName;
    }

    /// <summary>
    /// Reads the manifest out of an archive without extracting the payload, so the admin can
    /// see the version and notes before committing the upload.
    /// </summary>
    public OfflineUpdateStatus? InspectArchive(string archivePath)
    {
        try
        {
            using var zip = ZipFile.OpenRead(archivePath);
            var entry = zip.GetEntry(Licensing.UpdatePackageManifest.FileName);
            if (entry is null) return null;
            using var reader = new StreamReader(entry.Open());
            var manifest = Licensing.UpdatePackageJson.TryParse(reader.ReadToEnd());
            if (manifest is null) return null;
            return new OfflineUpdateStatus
            {
                Uploaded = true,
                Version = manifest.Version,
                Notes = manifest.Notes,
                ArchivePath = archivePath
            };
        }
        catch (InvalidDataException ex)
        {
            _log.LogWarning(ex, "Update archive {Path} is not a readable zip.", archivePath);
            return null;
        }
    }

    /// <summary>
    /// Validates and stages an archive: the manifest must parse, the version must be newer
    /// than <paramref name="currentVersion"/> and satisfy its own floor, and every listed file
    /// must be present with a matching hash. Staging is written to a fresh folder that only
    /// replaces the previous one after the whole package checks out.
    /// </summary>
    public OfflineUpdateStatus Stage(string archivePath, string currentVersion, CancellationToken ct = default)
    {
        if (!File.Exists(archivePath))
            return new OfflineUpdateStatus { Error = "upload.missing" };

        var finalRoot = Path.Combine(StagingDirectory, "current");
        var workRoot = Path.Combine(StagingDirectory, "staging-" + Guid.NewGuid().ToString("N"));

        try
        {
            using var zip = ZipFile.OpenRead(archivePath);

            var manifestEntry = zip.GetEntry(Licensing.UpdatePackageManifest.FileName);
            if (manifestEntry is null)
                return new OfflineUpdateStatus { Error = "manifest.missing" };

            string manifestJson;
            using (var reader = new StreamReader(manifestEntry.Open()))
                manifestJson = reader.ReadToEnd();

            var manifest = Licensing.UpdatePackageJson.TryParse(manifestJson);
            if (manifest is null)
                return new OfflineUpdateStatus { Error = "manifest.invalid" };

            if (!Licensing.UpdatePackageJson.IsNewer(manifest.Version, currentVersion))
                return new OfflineUpdateStatus { Error = "version.notNewer", Version = manifest.Version };

            if (!Licensing.UpdatePackageJson.MeetsMinimum(currentVersion, manifest.MinCurrentVersion))
                return new OfflineUpdateStatus { Error = "version.tooOld", Version = manifest.Version };

            Directory.CreateDirectory(workRoot);

            // Extract only the files the manifest vouches for. Anything else in the archive
            // (a stray script, a nested tree) is ignored rather than written to disk.
            foreach (var file in manifest.Files)
            {
                ct.ThrowIfCancellationRequested();

                var relative = NormalizeRelative(file.Path);
                if (relative is null)
                    return new OfflineUpdateStatus { Error = "entry.unsafe", Version = manifest.Version };

                var entry = zip.GetEntry(relative.Replace('\\', '/'))
                            ?? zip.GetEntry(relative);
                if (entry is null)
                    return new OfflineUpdateStatus { Error = "entry.missing", Version = manifest.Version };

                var target = Path.Combine(workRoot, relative);
                var targetDir = Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(targetDir)) Directory.CreateDirectory(targetDir);

                entry.ExtractToFile(target, overwrite: true);

                var actual = Licensing.UpdatePackageJson.HashFile(target);
                if (!string.Equals(actual, file.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    _log.LogWarning("Update package {Version}: hash mismatch for {Path}.", manifest.Version, relative);
                    return new OfflineUpdateStatus { Error = "entry.hashMismatch", Version = manifest.Version };
                }
            }

            // The updater script is not described by the manifest (it is the thing that runs
            // it), so it is copied last, after the payload has already been proven intact.
            var scriptName = Licensing.UpdatePackageBuilder.ScriptName;
            if (zip.GetEntry(scriptName) is { } script)
                script.ExtractToFile(Path.Combine(workRoot, scriptName), overwrite: true);

            if (Directory.Exists(finalRoot))
                Directory.Delete(finalRoot, recursive: true);
            Directory.Move(workRoot, finalRoot);

            return new OfflineUpdateStatus
            {
                Uploaded = true,
                Staged = true,
                Version = manifest.Version,
                Notes = manifest.Notes,
                UploadedUtc = DateTime.UtcNow.ToString("O"),
                ArchivePath = archivePath,
                StagedPath = finalRoot,
                UpdaterScript = File.Exists(Path.Combine(finalRoot, scriptName))
                    ? Path.Combine(finalRoot, scriptName)
                    : null
            };
        }
        catch (InvalidDataException ex)
        {
            _log.LogWarning(ex, "Update archive {Path} is corrupt.", archivePath);
            return new OfflineUpdateStatus { Error = "archive.corrupt" };
        }
        finally
        {
            try { if (Directory.Exists(workRoot)) Directory.Delete(workRoot, recursive: true); }
            catch (IOException) { /* best effort; a leftover temp folder is harmless */ }
        }
    }

    /// <summary>
    /// Rejects absolute paths and any <c>..</c> segment. An archive is untrusted input, and a
    /// manifest is just text inside it, so extraction must never be steered outside the
    /// staging root.
    /// </summary>
    private static string? NormalizeRelative(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var candidate = path.Replace('\\', '/').TrimStart('/');
        if (string.IsNullOrEmpty(candidate)) return null;
        if (Path.IsPathRooted(candidate)) return null;
        if (candidate.Contains(':')) return null;
        if (candidate.Split('/').Any(segment => segment is ".." or "." or ""))
            return null;
        return candidate;
    }

    /// <summary>Best-effort removal of the staged folder after an apply attempt.</summary>
    public void ClearStaged()
    {
        try
        {
            if (Directory.Exists(StagingDirectory)) Directory.Delete(StagingDirectory, recursive: true);
        }
        catch (IOException ex)
        {
            _log.LogDebug(ex, "Could not clear staged update folder.");
        }
    }

    private string Resolve(string path)
        => Path.IsPathRooted(path) ? path : Path.Combine(_contentRoot, path);
}
