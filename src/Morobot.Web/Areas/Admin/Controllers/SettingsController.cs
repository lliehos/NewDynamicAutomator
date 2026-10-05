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
    private readonly LicenseService _license;

    public SettingsController(
        SystemSettingsService settings,
        AppDbContext db,
        ILocaleService locale,
        LicenseService license)
    {
        _settings = settings;
        _db = db;
        _locale = locale;
        _license = license;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        ViewData["Title"] = _locale["admin.settings.title"];
        var all = await _settings.ListAsync(ct);
        // Without plan management there is no plan for a new account to be registered on — the
        // registration path picks the deployment's top plan — so the field is filtered out rather
        // than shown as a choice that changes nothing.
        var allowsPlanManagement = (await _license.GetRuntimeStateAsync(ct)).AllowsPlanManagement;
        var vm = new AdminSettingsViewModel
        {
            AllowsPlanManagement = allowsPlanManagement,
            // Branding keys are edited on Admin → Branding only; showing them here too meant
            // two pages wrote the same rows and a stale save could clobber the other page.
            Settings = all
                .Where(s => allowsPlanManagement || !string.Equals(s.Key, SystemSettingKeys.DefaultRegisterPlan, StringComparison.OrdinalIgnoreCase))
                .Where(s => !SystemSettingKeys.IsBrandingOwned(s.Key))
                // The legacy AuthMode row is superseded by the two provider switches. It survives
                // in the table only so an install too old to have been seeded with them still
                // resolves its sign-in, and rendering it here would offer a second, contradictory
                // way to choose the same thing.
                .Where(s => !SystemSettingKeys.IsSuperseded(s.Key))
                // Auth reads top-to-bottom: which providers are on, then the directory they
                // configure, then the fallback plan. The service orders alphabetically, which
                // separated the LDAP switch from the very fields it governs.
                .OrderBy(s => SystemSettingKeys.OrderOf(s.Group, s.Key))
                .ToList(),
            Plans = await _db.Plans.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync(ct)
        };
        return View(vm);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Index(IFormCollection form, CancellationToken ct)
    {
        // The plan field is not rendered without plan management; ignoring it here keeps a crafted
        // POST from writing a setting the page deliberately does not offer.
        var allowsPlanManagement = (await _license.GetRuntimeStateAsync(ct)).AllowsPlanManagement;

        var pairs = form.Keys
            .Where(k => k.StartsWith("setting_", StringComparison.OrdinalIgnoreCase))
            // A hidden "false" plus a checkbox "true" of the same name is the standard HTML way to
            // send a boolean. The browser posts both when the box is ticked, so reading the whole
            // value would yield "false,true" — take the last entry, which is the checkbox's own
            // value when present and the hidden one otherwise.
            .Select(k => (k["setting_".Length..], LastValue(form, k)))
            // Defence in depth: ignore branding keys even if a crafted form posts them.
            .Where(p => !SystemSettingKeys.IsBrandingOwned(p.Item1))
            // Likewise the plan field, which the page does not render without plan management.
            .Where(p => allowsPlanManagement
                || !string.Equals(p.Item1, SystemSettingKeys.DefaultRegisterPlan, StringComparison.OrdinalIgnoreCase))
            // Likewise for the superseded AuthMode row: the two switches are the only authority on
            // which providers are live, and a stale row must not be written back alongside them.
            .Where(p => !SystemSettingKeys.IsSuperseded(p.Item1))
            // A blank secret means "leave it alone", not "erase it". The page cannot show the
            // current value back, so it always submits blank; treating that as a clear would wipe
            // the bind password every time any other setting was saved.
            .Where(p => !(SystemSettingKeys.IsSensitiveForAdmin(p.Item1) && string.IsNullOrEmpty(p.Item2)))
            .ToList();

        // The two sign-in switches are independent and may BOTH be on. The only forbidden state is
        // both off, which would leave nobody able to sign in — including the administrator who
        // would fix it. The form's own JS prevents it, but a crafted POST would not, so the rule is
        // enforced here too and the correction is reported.
        //
        // Missing keys must not read as "off". A switch that is present is authoritative; a switch
        // absent from the POST keeps its stored value, because a form that does not mention a
        // setting has not made a decision about it. Treating "absent" as "off" would silently clear
        // a provider every time a partial form was submitted.
        var pairsByName = pairs.ToDictionary(p => p.Item1, p => p.Item2, StringComparer.OrdinalIgnoreCase);
        if (pairsByName.ContainsKey(SystemSettingKeys.AuthLocalEnabled)
            || pairsByName.ContainsKey(SystemSettingKeys.AuthLdapEnabled))
        {
            var local = pairsByName.ContainsKey(SystemSettingKeys.AuthLocalEnabled)
                ? IsTruthy(pairsByName[SystemSettingKeys.AuthLocalEnabled])
                : IsTruthy(await _settings.GetAsync(SystemSettingKeys.AuthLocalEnabled, "true", ct));
            var ldap = pairsByName.ContainsKey(SystemSettingKeys.AuthLdapEnabled)
                ? IsTruthy(pairsByName[SystemSettingKeys.AuthLdapEnabled])
                : IsTruthy(await _settings.GetAsync(SystemSettingKeys.AuthLdapEnabled, "false", ct));

            var (fixedLocal, fixedLdap, corrected) = SystemSettingKeys.NormalizeAuthProviders(local, ldap);
            if (corrected)
            {
                SetPair(pairs, SystemSettingKeys.AuthLocalEnabled, fixedLocal ? "true" : "false");
                SetPair(pairs, SystemSettingKeys.AuthLdapEnabled, fixedLdap ? "true" : "false");
                TempData["Warn"] = _locale["admin.settings.oneAuthRequired"];
            }
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
    public async Task<IActionResult> SetLanguage(string lang, string? returnUrl = null, CancellationToken ct = default)
    {
        // The switch is hidden when the licence excludes the second language, so this only stops a
        // crafted POST from storing a choice the install cannot serve. Without it the visitor would
        // be left with a cookie that the middleware silently overrides, which looks like the switch
        // being broken rather than unavailable.
        if (await IsBilingualAsync(ct))
            LocaleService.SetCookie(Response, lang);

        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            return Redirect(returnUrl);
        return RedirectToAction(nameof(Index));
    }

    private async Task<bool> IsBilingualAsync(CancellationToken ct)
    {
        try { return (await _license.GetRuntimeStateAsync(ct)).AllowsBilingual; }
        catch { return true; }
    }
}
