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

        // The two sign-in switches must never both be off — that would leave nobody able to sign in,
        // including the administrator who would fix it. The form's own JS prevents it, but a crafted
        // POST would not, so the rule is enforced here too and the correction is reported.
        var pairsByName = pairs.ToDictionary(p => p.Item1, p => p.Item2, StringComparer.OrdinalIgnoreCase);
        if (pairsByName.ContainsKey(SystemSettingKeys.AuthLocalEnabled)
            || pairsByName.ContainsKey(SystemSettingKeys.AuthLdapEnabled))
        {
            var local = IsTruthy(pairsByName.GetValueOrDefault(SystemSettingKeys.AuthLocalEnabled));
            var ldap = IsTruthy(pairsByName.GetValueOrDefault(SystemSettingKeys.AuthLdapEnabled));
            var (fixedLocal, fixedLdap, corrected) = SystemSettingKeys.NormalizeAuthProviders(local, ldap);
            if (corrected)
            {
                SetPair(pairs, SystemSettingKeys.AuthLocalEnabled, fixedLocal ? "true" : "false");
                SetPair(pairs, SystemSettingKeys.AuthLdapEnabled, fixedLdap ? "true" : "false");
                TempData["Warn"] = _locale["admin.settings.oneAuthRequired"];
            }
            // Keep the legacy single row in step so anything still reading it agrees with the
            // switches: LDAP-only means Ldap, otherwise Local.
            SetPair(pairs, SystemSettingKeys.AuthMode, fixedLocal ? "Local" : "Ldap");
        }
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

    /// <summary>
    /// Reads a posted switch. The value reaches us as the last entry of a "false,true" pair (see
    /// <see cref="LastValue"/>), so the usual truthy spellings are accepted rather than only "true".
    /// </summary>
    private static bool IsTruthy(string? value) =>
        value is "true" or "True" or "1" or "on" or "yes";

    /// <summary>
    /// Forces a key to the given value in the outgoing list, replacing the posted entry when there
    /// is one so the corrected value is the only one that reaches the database.
    /// </summary>
    private static void SetPair(List<(string, string)> pairs, string key, string value)
    {
        var index = pairs.FindIndex(p => string.Equals(p.Item1, key, StringComparison.OrdinalIgnoreCase));
        if (index >= 0) pairs[index] = (pairs[index].Item1, value);
        else pairs.Add((key, value));
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
