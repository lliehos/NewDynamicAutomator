using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using Morobot.Domain;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Morobot.Web.Areas.Admin.Models;
using Morobot.Web.Services;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class SettingsController : Controller
{
    private readonly SystemSettingsService _settings;
    private readonly AppDbContext _db;
    private readonly ILocaleService _locale;

    public SettingsController(SystemSettingsService settings, AppDbContext db, ILocaleService locale)
    {
        _settings = settings;
        _db = db;
        _locale = locale;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = _locale["admin.settings.title"];
        var all = await _settings.ListAsync(ct);
        var vm = new AdminSettingsViewModel
        {
            // Branding keys are edited on Admin → Branding only; showing them here too meant
            // two pages wrote the same rows and a stale save could clobber the other page.
            Settings = all.Where(s => !SystemSettingKeys.IsBrandingOwned(s.Key)).ToList(),
            Plans = await _db.Plans.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync(ct)
        };
        return View(vm);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Index(IFormCollection form, CancellationToken ct)
    {
        var pairs = form.Keys
            .Where(k => k.StartsWith("setting_", StringComparison.OrdinalIgnoreCase))
            // A hidden "false" plus a checkbox "true" of the same name is the standard HTML way to
            // send a boolean. The browser posts both when the box is ticked, so reading the whole
            // value would yield "false,true" — take the last entry, which is the checkbox's own
            // value when present and the hidden one otherwise.
            .Select(k => (k["setting_".Length..], LastValue(form, k)))
            // Defence in depth: ignore branding keys even if a crafted form posts them.
            .Where(p => !SystemSettingKeys.IsBrandingOwned(p.Item1))
            // A blank secret means "leave it alone", not "erase it". The page cannot show the
            // current value back, so it always submits blank; treating that as a clear would wipe
            // the bind password every time any other setting was saved.
            .Where(p => !(SystemSettingKeys.IsSensitiveForAdmin(p.Item1) && string.IsNullOrEmpty(p.Item2)))
            .ToList();
        // Record who made the change so the settings list can show it and the audit log can
        // answer it later; without the actor the history would be anonymous.
        var userId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : (int?)null;
        await _settings.SaveAsync(pairs, userId, User.Identity?.Name, ct);
        TempData["Ok"] = _locale["admin.settings.saved"];
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// The value a control actually submitted. One name can appear several times in a form — the
    /// hidden-plus-checkbox boolean pattern above is the common case — and the last occurrence is
    /// the control the user interacted with, so that is the one that wins.
    /// </summary>
    private static string LastValue(IFormCollection form, string key)
    {
        var values = form[key];
        for (var i = values.Count - 1; i >= 0; i--)
        {
            var v = values[i];
            if (!string.IsNullOrEmpty(v)) return v;
        }
        return "";
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult SetLanguage(string lang, string? returnUrl = null)
    {
        LocaleService.SetCookie(Response, lang);
        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            return Redirect(returnUrl);
        return RedirectToAction(nameof(Index));
    }
}
