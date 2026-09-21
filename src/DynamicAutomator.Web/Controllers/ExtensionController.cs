using System.IO.Compression;
using DynamicAutomator.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Controllers;

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

    /// <summary>
    /// Dev/local stamp of the user install folder. Extension polls and reloads when this changes.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("/extension/dev-stamp")]
    public IActionResult DevStamp()
    {
        // Available in Development always; also in non-dev when install folder exists (local-first).
        if (!_env.IsDevelopment() && !Directory.Exists(_sync.InstallPath))
            return NotFound();

        var info = _sync.GetStamp(syncFirst: true);
        return Json(new
        {
            stamp = info.Stamp,
            bootId = info.BootId,
            version = info.Version,
            path = info.InstallPath,
            source = info.SourcePath
        });
    }

    [AllowAnonymous]
    [HttpGet("/extension/install-path")]
    public IActionResult InstallPathInfo()
    {
        var result = _sync.SyncNow("install-path");
        return Json(new
        {
            ok = result.Ok,
            path = result.InstallPath,
            source = result.SourcePath,
            stamp = result.Stamp,
            version = _sync.GetStamp(syncFirst: false).Version,
            error = result.Error,
            hint = "در chrome://extensions → Developer mode → Load unpacked → همین مسیر را یک‌بار انتخاب کنید."
        });
    }

    [AllowAnonymous]
    [HttpPost("/extension/sync")]
    public IActionResult Sync()
    {
        var result = _sync.SyncNow("api");
        return Json(new { ok = result.Ok, path = result.InstallPath, stamp = result.Stamp, error = result.Error });
    }

    [HttpGet("/extension/download")]
    public IActionResult Download()
    {
        _sync.SyncNow("download");
        var source = Directory.Exists(_sync.InstallPath) ? _sync.InstallPath : _sync.SourcePath;
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
        return File(ms, "application/zip", "dynamic-automator-extension.zip");
    }

    [HttpGet]
    public IActionResult Install()
    {
        var sync = _sync.SyncNow("install-page");
        ViewBag.ExtensionPath = sync.InstallPath;
        ViewBag.SourcePath = sync.SourcePath ?? "";
        ViewBag.IsDev = _env.IsDevelopment();
        ViewBag.Version = _sync.GetStamp(syncFirst: false).Version;
        return View();
    }
}
