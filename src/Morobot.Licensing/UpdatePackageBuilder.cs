using System.IO.Compression;

namespace Morobot.Licensing;

/// <summary>Outcome of building an update package.</summary>
public sealed record UpdatePackageBuildResult(string ZipPath, UpdatePackageManifest Manifest, int FileCount);

/// <summary>
/// Turns a folder of published application files into a self-describing offline update
/// package: the files, an <c>update.ps1</c> that swaps them in place, and a
/// <c>morobot-update.json</c> manifest listing every file with its SHA-256.
/// </summary>
/// <remarks>
/// Kept in this shared assembly so the CLI tool and the Vendor Studio build byte-identical
/// packages. The manifest is written last, after the payload is hashed, so a package can
/// never describe files it does not actually contain.
/// </remarks>
public static class UpdatePackageBuilder
{
    /// <summary>Name of the updater script placed at the archive root.</summary>
    public const string ScriptName = "update.ps1";

    /// <summary>
    /// Builds <paramref name="zipPath"/> from the contents of <paramref name="sourceDir"/>.
    /// <paramref name="zipPath"/> may live inside <paramref name="sourceDir"/>; it is excluded
    /// from the payload so rebuilding in place does not nest the previous archive.
    /// </summary>
    public static UpdatePackageBuildResult Build(
        string sourceDir,
        string zipPath,
        string version,
        string? notes = null,
        string? channel = null,
        string? minCurrentVersion = null,
        string? productName = null,
        CancellationToken ct = default)
    {
        if (!Directory.Exists(sourceDir))
            throw new DirectoryNotFoundException($"Source folder not found: {sourceDir}");
        if (string.IsNullOrWhiteSpace(version))
            throw new ArgumentException("A package version is required.", nameof(version));
        if (!Version.TryParse(version.Trim(), out _))
            throw new ArgumentException($"'{version}' is not a valid version number.", nameof(version));

        var root = Path.GetFullPath(sourceDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var zipFull = Path.GetFullPath(zipPath);
        var staging = Path.Combine(Path.GetTempPath(), "morobot-update-" + Guid.NewGuid().ToString("N"));

        try
        {
            Directory.CreateDirectory(staging);

            var manifest = new UpdatePackageManifest
            {
                Version = version.Trim(),
                ReleasedUtc = DateTime.UtcNow,
                Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(),
                Channel = string.IsNullOrWhiteSpace(channel) ? null : channel.Trim(),
                MinCurrentVersion = string.IsNullOrWhiteSpace(minCurrentVersion) ? null : minCurrentVersion.Trim(),
                Entrypoint = ScriptName
            };

            foreach (var file in EnumeratePayload(root, zipFull))
            {
                ct.ThrowIfCancellationRequested();
                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                var staged = Path.Combine(staging, relative.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(staged)!);
                File.Copy(file, staged, overwrite: true);

                manifest.Files.Add(new UpdatePackageFile
                {
                    Path = relative,
                    Sha256 = UpdatePackageJson.HashFile(file),
                    Size = new FileInfo(file).Length
                });
            }

            File.WriteAllText(Path.Combine(staging, UpdatePackageManifest.FileName), UpdatePackageJson.Serialize(manifest));
            File.WriteAllText(Path.Combine(staging, ScriptName), BuildWindowsScript(productName));

            var zipDir = Path.GetDirectoryName(zipFull);
            if (!string.IsNullOrEmpty(zipDir)) Directory.CreateDirectory(zipDir);
            if (File.Exists(zipFull)) File.Delete(zipFull);
            ZipFile.CreateFromDirectory(staging, zipFull, CompressionLevel.Optimal, includeBaseDirectory: false);

            return new UpdatePackageBuildResult(zipFull, manifest, manifest.Files.Count);
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true); }
            catch (IOException) { /* a locked temp file must not fail an otherwise good package */ }
        }
    }

    /// <summary>
    /// Every file that belongs in the payload: the source folder, minus the archive being
    /// written, minus anything the updater generates on the target (logs, staged archives).
    /// </summary>
    private static IEnumerable<string> EnumeratePayload(string root, string zipFull)
    {
        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            var full = Path.GetFullPath(file);
            if (string.Equals(full, zipFull, StringComparison.OrdinalIgnoreCase))
                continue;

            // The server keeps its own copies here; shipping them would bloat the package
            // and the staged folder is rebuilt on the target anyway.
            var relative = Path.GetRelativePath(root, full).Replace('\\', '/');
            if (relative.StartsWith("updates/staged/", StringComparison.OrdinalIgnoreCase)
                || relative.StartsWith("updates/uploaded/", StringComparison.OrdinalIgnoreCase))
                continue;

            yield return full;
        }
    }

    /// <summary>
    /// Writes the updater script. It only stages the swap: the server runs it after
    /// shutting itself down, so the script replaces files, copies any bundled
    /// <c>update.db</c> marker, restarts the app, and records its own log next to the script.
    /// </summary>
    private static string BuildWindowsScript(string? productName)
    {
        var label = string.IsNullOrWhiteSpace(productName) ? "Morobot" : productName.Trim();
        var script = """
# {LABEL} offline updater — generated by the vendor tooling.
# Run from the extracted package folder AFTER the application has stopped.
#    powershell -ExecutionPolicy Bypass -File .\update.ps1 -TargetDir "C:\Morobot" [-Restart]
param(
  [Parameter(Mandatory = $true)][string]$TargetDir,
  [switch]$Restart,
  [string]$StartCommand = ""
)

$ErrorActionPreference = "Stop"
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $source "update.log"

function Write-Log([string]$message) {
  $line = "$(Get-Date -Format o)  $message"
  Write-Host $line
  Add-Content -Path $log -Value $line
}

Write-Log "Updating '$TargetDir' from '$source'."

if (-not (Test-Path -LiteralPath $TargetDir)) {
  Write-Log "Target folder does not exist: $TargetDir"
  exit 2
}

# A running server holds its own binaries open; copying over them fails with a sharing
# violation, so refuse early rather than half-applying the package.
$locked = Get-ChildItem -LiteralPath $source -Filter *.dll -File -ErrorAction SilentlyContinue | Where-Object {
  try { [System.IO.File]::Open($_.FullName, 'Open', 'ReadWrite', 'None').Close(); $false }
  catch { $true }
}
if ($locked) {
  Write-Log "Application still running - could not lock $($locked[0].Name). Stop the server and retry."
  exit 3
}

# Copy the payload, skipping the updater's own artefacts.
$skip = @("update.ps1", "update.log", "MANIFESTNAME")
Get-ChildItem -LiteralPath $source -File | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $TargetDir -Force
  Write-Log "copied $($_.Name)"
}

foreach ($dir in Get-ChildItem -LiteralPath $source -Directory) {
  $dest = Join-Path $TargetDir $dir.Name
  if (-not (Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
  Copy-Item -Path (Join-Path $dir.FullName '*') -Destination $dest -Recurse -Force
  Write-Log "copied $($dir.Name)/"
}

Write-Log "Payload applied."

if ($Restart) {
  if ([string]::IsNullOrWhiteSpace($StartCommand)) {
    $exe = Get-ChildItem -LiteralPath $TargetDir -Filter *.exe -File | Select-Object -First 1
    if ($exe) { $StartCommand = $exe.FullName }
  }
  if ([string]::IsNullOrWhiteSpace($StartCommand)) {
    Write-Log "No start command supplied and no executable found - skipping restart."
  } else {
    Write-Log "Restarting: $StartCommand"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$StartCommand`"" -WorkingDirectory $TargetDir
  }
}

Write-Log "Done."
""";
        return script
            .Replace("{LABEL}", label)
            .Replace("MANIFESTNAME", UpdatePackageManifest.FileName);
    }
}
