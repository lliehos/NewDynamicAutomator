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
    private readonly DiagramSettingsService _diagram;
    private readonly IWebHostEnvironment _env;
    private readonly ILocaleService _locale;
    private readonly ExtensionSyncService _sync;
    private readonly ExtensionBrandingOverlay _overlay;

    public BrandingController(
        BrandingService branding,
        LicenseService license,
        DiagramSettingsService diagram,
        IWebHostEnvironment env,
        ILocaleService locale,
        ExtensionSyncService sync,
        ExtensionBrandingOverlay overlay)
    {
        _branding = branding;
        _license = license;
        _diagram = diagram;
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
        var userId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : (int?)null;

        // Diagram colours are part of the branding licence, exactly like the identity, the logo and
        // the brand palette — so an unlicensed install cannot change them and the whole page is one
        // decision rather than a licensed section with an unlicensed pocket inside it.
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
        // The legacy single-value identity rows are no longer posted by the form. Carry the stored
        // values through so the model handed to the service is complete, and so a future caller that
        // does read them sees what is actually saved rather than the default.
        model.AppName = existing.AppName;
        model.BrandTitle = existing.BrandTitle;
        model.OrganizationName = existing.OrganizationName;

        Directory.CreateDirectory(Path.Combine(_env.WebRootPath, "uploads", "branding"));

        if (logoFile is { Length: > 0 })
            model.LogoUrl = await SaveBrandFileAsync(logoFile, "logo", ct);
        if (faviconFile is { Length: > 0 })
            model.FaviconUrl = await SaveBrandFileAsync(faviconFile, "favicon", ct);

        try
        {
            // Only the referral-QR switch still posts hidden+checkbox; the diagram colours no longer
            // carry a switch at all (reset-to-default replaced them, see ResetColor).
            model.ShowReferralQrWidget = ReadSwitch(Request.Form, "ShowReferralQrWidget");

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

    /// <summary>
    /// The diagram defaults exactly as the editor receives them.
    /// </summary>
    /// <remarks>
    /// Exposed so the colour editor can be checked against what flow.js will actually be handed —
    /// a colour that saves but never reaches the payload would look correct on this page and change
    /// nothing on the canvas.
    /// </remarks>
    [HttpGet]
    public async Task<IActionResult> DiagramDefaults(CancellationToken ct)
        => Json(await _diagram.GetAsync(ct));

    /// <summary>
    /// Restore one diagram colour to the value the product ships.
    /// </summary>
    /// <remarks>
    /// This replaces the per-colour "apply" switches. A switch made every colour mean two settings
    /// and left the editor wondering which won; resetting writes the shipped value into the one
    /// setting, so the page simply shows the restored colour.
    ///
    /// Licence-gated with the rest of the diagram colours: leaving it open would have been a hole in
    /// the gate, since writing the shipped value changes the palette just as much as choosing a new
    /// one does.
    /// </remarks>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ResetColor(string key, CancellationToken ct)
    {
        var runtime = await _license.GetRuntimeStateAsync(ct);
        if (!runtime.AllowsBranding)
        {
            TempData["Danger"] = _locale["admin.branding.notLicensed"];
            return RedirectToAction("Index", "License");
        }

        var userId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : (int?)null;
        var done = await _branding.ResetDiagramColorAsync(key, userId, User.Identity?.Name, ct);
        if (!done) return NotFound();

        // Answer the restored value so the page can update the picker in place, without a reload
        // that would lose any other edit the administrator has open.
        var fallback = Morobot.Domain.SystemSettingKeys.DiagramColorDefault(key);
        return Json(new { ok = true, key, value = fallback });
    }

    /// <summary>
    /// The value a switch actually submitted.
    /// </summary>
    /// <remarks>
    /// A hidden "false" plus a checkbox "true" of the same name is the standard HTML way to send a
    /// boolean, and the browser posts BOTH when the box is ticked. The LAST entry is the control the
    /// user interacted with, so that is the one that decides. Letting model binding pick instead
    /// would take the first — the hidden "false" — and turn the switch off whatever the user did.
    /// </remarks>
    private static bool ReadSwitch(IFormCollection form, string name)
    {
        var values = form[name];
        for (var i = values.Count - 1; i >= 0; i--)
        {
            var v = values[i];
            if (string.IsNullOrEmpty(v)) continue;
            return v is "true" or "True" or "1" or "on" or "yes";
        }
        return false;
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
