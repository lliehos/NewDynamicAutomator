using System.IO.Compression;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Controllers;

[Authorize]
public class ExtensionController : Controller
{
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;

    public ExtensionController(IWebHostEnvironment env, IConfiguration config)
    {
        _env = env;
        _config = config;
    }

    [HttpGet("/extension/download")]
    public IActionResult Download()
    {
        var source = ResolveExtensionFolder();
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
        ViewBag.ExtensionPath = ResolveExtensionFolder() ?? "";
        ViewBag.IsDev = _env.IsDevelopment();
        return View();
    }

    private string? ResolveExtensionFolder()
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
}
