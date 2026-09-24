using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Contracts.Licensing;
using Morobot.Infrastructure.Services;
using Morobot.Web.Areas.Admin.Models;
using Morobot.Web.Services;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class BrandingController : Controller
{
    private readonly BrandingService _branding;
    private readonly LicenseService _license;
    private readonly IWebHostEnvironment _env;
    private readonly ILocaleService _locale;

    public BrandingController(
        BrandingService branding,
        LicenseService license,
        IWebHostEnvironment env,
        ILocaleService locale)
    {
        _branding = branding;
        _license = license;
        _env = env;
        _locale = locale;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var runtime = await _license.GetRuntimeStateAsync(ct);
        if (!runtime.AllowsBranding)
        {
            TempData["Ok"] = _locale["admin.branding.notLicensed"];
            return RedirectToAction("Index", "License");
        }

        ViewData["Title"] = _locale["admin.branding.title"];
        return View(await _branding.GetAsync(ct));
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Index(TenantBrandingDto model, IFormFile? logoFile, IFormFile? faviconFile, CancellationToken ct)
    {
        var runtime = await _license.GetRuntimeStateAsync(ct);
        if (!runtime.AllowsBranding)
        {
            TempData["Ok"] = _locale["admin.branding.notLicensed"];
            return RedirectToAction("Index", "License");
        }

        Directory.CreateDirectory(Path.Combine(_env.WebRootPath, "uploads", "branding"));

        if (logoFile is { Length: > 0 })
            model.LogoUrl = await SaveBrandFileAsync(logoFile, "logo", ct);
        if (faviconFile is { Length: > 0 })
            model.FaviconUrl = await SaveBrandFileAsync(faviconFile, "favicon", ct);

        try
        {
            await _branding.SaveAsync(model, ct);
            TempData["Ok"] = _locale["admin.branding.saved"];
        }
        catch (InvalidOperationException)
        {
            TempData["Ok"] = _locale["admin.branding.notLicensed"];
        }

        return RedirectToAction(nameof(Index));
    }

    private async Task<string> SaveBrandFileAsync(IFormFile file, string prefix, CancellationToken ct)
    {
        var ext = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(ext)) ext = ".png";
        var name = $"{prefix}{ext.ToLowerInvariant()}";
        var physical = Path.Combine(_env.WebRootPath, "uploads", "branding", name);
        await using var stream = System.IO.File.Create(physical);
        await file.CopyToAsync(stream, ct);
        return $"/uploads/branding/{name}";
    }
}
