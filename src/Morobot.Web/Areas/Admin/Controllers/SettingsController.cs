using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
        var vm = new AdminSettingsViewModel
        {
            Settings = await _settings.ListAsync(ct),
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
            .Select(k => (k["setting_".Length..], form[k].ToString() ?? ""))
            .ToList();
        await _settings.SaveAsync(pairs, ct);
        TempData["Ok"] = _locale["admin.settings.saved"];
        return RedirectToAction(nameof(Index));
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
