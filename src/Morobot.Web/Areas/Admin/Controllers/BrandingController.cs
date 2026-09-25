using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
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
    private readonly ExtensionSyncService _sync;
    private readonly ExtensionBrandingOverlay _overlay;

    public BrandingController(
        BrandingService branding,
        LicenseService license,
        IWebHostEnvironment env,
        ILocaleService locale,
        ExtensionSyncService sync,
        ExtensionBrandingOverlay overlay)
    {
        _branding = branding;
        _license = license;
        _env = env;
        _locale = locale;
        _sync = sync;
        _overlay = overlay;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var runtime = await _license.GetRuntimeStateAsync(ct);
        if (!runtime.AllowsBranding)
        {
            TempData["Danger"] = _locale["admin.branding.notLicensed"];
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
            TempData["Danger"] = _locale["admin.branding.notLicensed"];
            return RedirectToAction("Index", "License");
        }

        var existing = await _branding.GetAsync(ct);
        if (string.IsNullOrWhiteSpace(model.LogoUrl))
            model.LogoUrl = existing.LogoUrl;
        if (string.IsNullOrWhiteSpace(model.FaviconUrl))
            model.FaviconUrl = existing.FaviconUrl;

        Directory.CreateDirectory(Path.Combine(_env.WebRootPath, "uploads", "branding"));

        if (logoFile is { Length: > 0 })
            model.LogoUrl = await SaveBrandFileAsync(logoFile, "logo", ct);
        if (faviconFile is { Length: > 0 })
            model.FaviconUrl = await SaveBrandFileAsync(faviconFile, "favicon", ct);

        try
        {
            model.ShowReferralQrWidget = Request.Form["ShowReferralQrWidget"].Contains("true");
            var userId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : (int?)null;
            await _branding.SaveAsync(model, userId, User.Identity?.Name, ct);
            _sync.SyncNow("branding-save");
            await _overlay.ApplyAllPackagesAsync(_sync, ct);
            TempData["Ok"] = _locale["admin.branding.saved"];
        }
        catch (InvalidOperationException)
        {
            TempData["Danger"] = _locale["admin.branding.notLicensed"];
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
