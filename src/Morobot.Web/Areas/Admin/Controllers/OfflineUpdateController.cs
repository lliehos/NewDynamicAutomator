using System.Diagnostics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Domain;
using Morobot.Infrastructure.Options;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Morobot.Web.Services;
using Microsoft.Extensions.Options;

namespace Morobot.Web.Areas.Admin.Controllers;

/// <summary>
/// Admin → License → Offline update: upload an update archive, verify it, and stage it
/// for the restart helper to apply.
/// </summary>
/// <remarks>
/// The upload path exists for installs with no route to the update feed. Because an
/// archive is opaque input, nothing is written outside the staging folder until the
/// manifest has been parsed and every file's hash verified — see
/// <see cref="OfflineUpdateService.Stage"/>. Applying the staged files is deliberately not
/// something the web process can do to itself: it holds its own assemblies open, so the
/// swap is handed to a script the operator runs once the app has stopped.
/// </remarks>
[Area("Admin")]
[Authorize(Roles = "Admin")]
public class OfflineUpdateController : Controller
{
    private readonly OfflineUpdateService _offline;
    private readonly OfflineUpdateOptions _options;
    private readonly UpdateCheckService _updates;
    private readonly UpdateNotifyStateService _notifyState;
    private readonly SystemSettingsService _settings;
    private readonly ILocaleService _locale;
    private readonly ILogger<OfflineUpdateController> _log;

    public OfflineUpdateController(
        OfflineUpdateService offline,
        IOptions<OfflineUpdateOptions> options,
        UpdateCheckService updates,
        UpdateNotifyStateService notifyState,
        SystemSettingsService settings,
        ILocaleService locale,
        ILogger<OfflineUpdateController> log)
    {
        _offline = offline;
        _options = options.Value;
        _updates = updates;
        _notifyState = notifyState;
        _settings = settings;
        _locale = locale;
        _log = log;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = _locale["admin.offlineUpdate.title"];
        ViewData["MaxUploadMb"] = _options.MaxUploadMegabytes;
        ViewData["Staged"] = _notifyState.Staged;
        ViewData["RestartCommand"] = _options.RestartCommand;
        return View();
    }

    /// <summary>
    /// Accepts an archive, inspects its manifest, and stages it when it is applicable.
    /// The archive itself is kept so a retry after a failed apply does not need a re-upload.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    [RequestSizeLimit(2L * 1024 * 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile? package, CancellationToken ct)
    {
        if (package is null || package.Length == 0)
        {
            TempData["Warn"] = _locale["admin.offlineUpdate.errEmpty"];
            return RedirectToAction(nameof(Index));
        }

        var maxBytes = (long)_options.MaxUploadMegabytes * 1024 * 1024;
        if (package.Length > maxBytes)
        {
            TempData["Danger"] = string.Format(_locale["admin.offlineUpdate.errTooLarge"], _options.MaxUploadMegabytes);
            return RedirectToAction(nameof(Index));
        }

        var uploadDir = _offline.UploadDirectory;
        Directory.CreateDirectory(uploadDir);
        var archivePath = Path.Combine(uploadDir, "morobot-update-" + Guid.NewGuid().ToString("N") + ".zip");

        try
        {
            await using (var target = System.IO.File.Create(archivePath))
                await package.CopyToAsync(target, ct);

            // A zip that is not an update package is rejected here, before anything is staged,
            // so the admin's mistake never touches the staging folder.
            var inspected = _offline.InspectArchive(archivePath);
            if (inspected is null)
            {
                TryDelete(archivePath);
                TempData["Danger"] = _locale["admin.offlineUpdate.errNotPackage"];
                return RedirectToAction(nameof(Index));
            }

            var status = await _updates.GetStatusAsync(ct);
            var staged = _offline.Stage(archivePath, status.CurrentVersion, ct);
            if (staged.Staged)
            {
                _notifyState.MarkStaged(staged.Version, archivePath, staged.StagedPath);
                await _settings.SetAsync(SystemSettingKeys.UpdateAvailableVersion, staged.Version ?? "", ct);
                await _settings.SetAsync(SystemSettingKeys.UpdateAvailableNotes, staged.Notes ?? "", ct);
                TempData["Ok"] = string.Format(_locale["admin.offlineUpdate.uploaded"], staged.Version);
            }
            else
            {
                TryDelete(archivePath);
                TempData["Danger"] = _locale[$"admin.offlineUpdate.{staged.Error ?? "errUnknown"}"];
            }
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Offline update upload failed.");
            TryDelete(archivePath);
            TempData["Danger"] = _locale["admin.offlineUpdate.errUpload"];
        }

        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Launches the staged updater. The app must be stopped first, so this is refused unless
    /// the operator asks for it explicitly; the returned page tells them what to run.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult Apply(bool stopFirst, CancellationToken ct)
    {
        var staged = _notifyState.Staged;
        if (staged is null || string.IsNullOrWhiteSpace(staged.StagedPath) || !Directory.Exists(staged.StagedPath))
        {
            TempData["Warn"] = _locale["admin.offlineUpdate.errNothingStaged"];
            return RedirectToAction(nameof(Index));
        }

        if (!stopFirst)
        {
            TempData["Warn"] = _locale["admin.offlineUpdate.errStopFirst"];
            return RedirectToAction(nameof(Index));
        }

        var script = Path.Combine(staged.StagedPath, Licensing.UpdatePackageBuilder.ScriptName);
        if (!System.IO.File.Exists(script))
        {
            TempData["Danger"] = _locale["admin.offlineUpdate.errNoScript"];
            return RedirectToAction(nameof(Index));
        }

        var command = string.IsNullOrWhiteSpace(_options.RestartCommand)
            ? ""
            : _options.RestartCommand!.Trim();
        var logPath = Path.Combine(staged.StagedPath, "update.log");

        try
        {
            // Detached: the process that starts the updater is about to be replaced by it.
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\" -TargetDir \"{AppContext.BaseDirectory.TrimEnd('\\')}\" -Restart -StartCommand \"{command}\"",
                WorkingDirectory = staged.StagedPath,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using var proc = Process.Start(psi);
            _log.LogWarning("Offline update launched for version {Version}; script {Script}, log {Log}.",
                staged.Version, script, logPath);
            TempData["Ok"] = string.Format(_locale["admin.offlineUpdate.applied"], staged.Version);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Could not launch the offline updater.");
            TempData["Danger"] = _locale["admin.offlineUpdate.errApply"];
        }

        return RedirectToAction(nameof(Index));
    }

    /// <summary>Discards the staged package and the archive it came from.</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult Discard(CancellationToken ct)
    {
        var staged = _notifyState.Staged;
        if (staged?.ArchivePath is { Length: > 0 } archive) TryDelete(archive);
        _offline.ClearStaged();
        _notifyState.Clear();
        TempData["Ok"] = _locale["admin.offlineUpdate.discarded"];
        return RedirectToAction(nameof(Index));
    }

    private static void TryDelete(string path)
    {
        try { if (System.IO.File.Exists(path)) System.IO.File.Delete(path); }
        catch (IOException) { /* a leftover archive is harmless and will be replaced next upload */ }
    }
}
