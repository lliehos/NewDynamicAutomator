using System.IO.Compression;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Panel.Controllers;

[Area("Panel")]
[Authorize]
public class ExtensionController : Controller
{
    private readonly IWebHostEnvironment _env;
    private readonly ExtensionSyncService _sync;

    public ExtensionController(IWebHostEnvironment env, ExtensionSyncService sync)
    {
        _env = env;
        _sync = sync;
    }

    [AllowAnonymous]
    [HttpGet("/extension/dev-stamp")]
    [HttpGet("/extension/dev-stamp/{role}")]
    public IActionResult DevStamp(string? role = null)
    {
        // Bare /extension/dev-stamp → combined stamp so either package change
        // wakes older extension builds that still poll the unscoped URL.
        if (string.IsNullOrWhiteSpace(role))
        {
            if (!_env.IsDevelopment()
                && !Directory.Exists(_sync.InstallPathFor(ExtensionSyncService.RoleRecorder))
                && !Directory.Exists(_sync.InstallPathFor(ExtensionSyncService.RolePlayer))
                && !Directory.Exists(_sync.InstallPathFor(ExtensionSyncService.RoleSelector))
                && !Directory.Exists(_sync.InstallPathFor(ExtensionSyncService.RoleSmart)))
                return NotFound();

            var rec = _sync.GetStamp(ExtensionSyncService.RoleRecorder, syncFirst: true);
            var play = _sync.GetStamp(ExtensionSyncService.RolePlayer, syncFirst: true);
            var sel = _sync.GetStamp(ExtensionSyncService.RoleSelector, syncFirst: true);
            var smart = _sync.GetStamp(ExtensionSyncService.RoleSmart, syncFirst: true);
            var combined = $"{rec.Stamp}|{play.Stamp}|{sel.Stamp}|{smart.Stamp}";
            return Json(new
            {
                stamp = combined,
                bootId = ExtensionSyncService.BootId,
                version = $"{rec.Version}+{play.Version}+{sel.Version}+{smart.Version}",
                path = play.InstallPath,
                source = play.SourcePath,
                role = "combined",
                recorder = new { stamp = rec.Stamp, version = rec.Version, path = rec.InstallPath },
                player = new { stamp = play.Stamp, version = play.Version, path = play.InstallPath },
                selector = new { stamp = sel.Stamp, version = sel.Version, path = sel.InstallPath },
                smart = new { stamp = smart.Stamp, version = smart.Version, path = smart.InstallPath }
            });
        }

        var install = _sync.InstallPathFor(role);
        if (!_env.IsDevelopment() && !Directory.Exists(install))
            return NotFound();

        var info = _sync.GetStamp(role, syncFirst: true);
        return Json(new
        {
            stamp = info.Stamp,
            bootId = info.BootId,
            version = info.Version,
            path = info.InstallPath,
            source = info.SourcePath,
            role = info.Role
        });
    }

    [AllowAnonymous]
    [HttpGet("/extension/install-path")]
    public IActionResult InstallPathInfo()
    {
        return Json(_sync.InstallPathsPayload());
    }

    [AllowAnonymous]
    [HttpPost("/extension/sync")]
    public IActionResult Sync()
    {
        var result = _sync.SyncNow("api");
        return Json(_sync.InstallPathsPayload());
    }

    [HttpGet("/extension/download/{role?}")]
    public IActionResult Download(string? role = null)
    {
        role ??= ExtensionSyncService.RoleRecorder;
        _sync.SyncRole(role, "download");
        var install = _sync.InstallPathFor(role);
        var source = Directory.Exists(install) ? install : _sync.SourcePathFor(role);
        if (source is null || !Directory.Exists(source))
            return NotFound("پوشه افزونه پیدا نشد.");

        var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(source, file).Replace('\\', '/');
                if (rel.StartsWith(".", StringComparison.Ordinal)) continue;
                zip.CreateEntryFromFile(file, rel, CompressionLevel.Optimal);
            }
        }
        ms.Position = 0;
        var name = role.Equals(ExtensionSyncService.RoleSmart, StringComparison.OrdinalIgnoreCase)
            || role.Equals("smart-recorder", StringComparison.OrdinalIgnoreCase)
            ? "morobot-smart-recorder.zip"
            : "morobot-global.zip";
        return File(ms, "application/zip", name);
    }

    [HttpGet]
    public IActionResult Install()
    {
        _sync.SyncNow("install-page");
        ViewBag.GlobalPath = _sync.InstallPathFor(ExtensionSyncService.RoleGlobal);
        ViewBag.GlobalVersion = _sync.GetStamp(ExtensionSyncService.RoleGlobal, syncFirst: false).Version;
        ViewBag.RecorderPath = ViewBag.GlobalPath;
        ViewBag.PlayerPath = ViewBag.GlobalPath;
        ViewBag.SelectorPath = ViewBag.GlobalPath;
        ViewBag.SmartPath = _sync.InstallPathFor(ExtensionSyncService.RoleSmart);
        ViewBag.RecorderVersion = ViewBag.GlobalVersion;
        ViewBag.PlayerVersion = ViewBag.GlobalVersion;
        ViewBag.SelectorVersion = ViewBag.GlobalVersion;
        ViewBag.SmartVersion = _sync.GetStamp(ExtensionSyncService.RoleSmart, syncFirst: false).Version;
        ViewBag.AppInstanceKey = _sync.AppInstanceKey;
        ViewBag.IsDev = _env.IsDevelopment();
        ViewBag.ExtensionPath = ViewBag.GlobalPath;
        ViewBag.Version = ViewBag.GlobalVersion;
        return View();
    }
}
