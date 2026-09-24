using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Infrastructure.Services;
using Morobot.Web.Areas.Admin.Models;
using Morobot.Web.Services;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class LicenseController : Controller
{
    private readonly LicenseService _license;
    private readonly UpdateCheckService _updates;
    private readonly ILocaleService _locale;

    public LicenseController(LicenseService license, UpdateCheckService updates, ILocaleService locale)
    {
        _license = license;
        _updates = updates;
        _locale = locale;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = _locale["admin.license.title"];
        var vm = new AdminLicenseViewModel
        {
            Display = await _license.GetDisplayAsync(ct),
            LicensingEnabled = _license.IsLicensingEnabled,
            UpdateStatus = await _updates.GetStatusAsync(ct)
        };
        return View(vm);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ExportRequest(string? organizationHint, CancellationToken ct)
    {
        var json = await _license.ExportActivationRequestJsonAsync(organizationHint, ct);
        var fileName = $"morobot-activation-{DateTime.UtcNow:yyyyMMddHHmmss}.json";
        return File(System.Text.Encoding.UTF8.GetBytes(json), "application/json", fileName);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Import(IFormFile? licenseFile, string? licenseText, CancellationToken ct)
    {
        string? raw = null;
        if (licenseFile is { Length: > 0 })
        {
            using var reader = new StreamReader(licenseFile.OpenReadStream());
            raw = await reader.ReadToEndAsync(ct);
        }
        else if (!string.IsNullOrWhiteSpace(licenseText))
        {
            raw = licenseText;
        }

        if (string.IsNullOrWhiteSpace(raw))
        {
            TempData["Warn"] = _locale["admin.license.importEmpty"];
            return RedirectToAction(nameof(Index));
        }

        var (ok, errorKey) = await _license.ImportAsync(raw, ct);
        if (ok)
            TempData["Ok"] = _locale["admin.license.importOk"];
        else
            TempData["Danger"] = _locale[errorKey ?? "license.error.invalid"];
        return RedirectToAction(nameof(Index));
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> CheckUpdate(CancellationToken ct)
    {
        var result = await _updates.CheckOnlineAsync(ct);
        TempData["Ok"] = result.Message ?? _locale["admin.updates.checked"];
        return RedirectToAction(nameof(Index));
    }
}
