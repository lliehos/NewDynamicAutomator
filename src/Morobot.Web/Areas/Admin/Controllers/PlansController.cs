using System.Text.RegularExpressions;
using Morobot.Domain.Entities;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class PlansController : Controller
{
    private static readonly Regex CodePattern = new(@"^[A-Za-z][A-Za-z0-9_]{1,39}$", RegexOptions.Compiled);
    private readonly AppDbContext _db;
    private readonly LicenseService _license;
    private readonly ILocaleService _locale;

    public PlansController(AppDbContext db, LicenseService license, ILocaleService locale)
    {
        _db = db;
        _license = license;
        _locale = locale;
    }

    /// <summary>
    /// True when the licence lets this deployment manage plan levels.
    /// </summary>
    /// <remarks>
    /// Everything on this page is gated on it. A licence without plan management has no levels —
    /// every user is served the top plan regardless of what these rows say — so leaving the page
    /// open would offer switches that silently do nothing.
    /// </remarks>
    private async Task<bool> AllowsPlanManagementAsync(CancellationToken ct)
        => (await _license.GetRuntimeStateAsync(ct)).AllowsPlanManagement;

    private IActionResult NotLicensed()
    {
        TempData["Danger"] = _locale["admin.plans.notLicensed"];
        return RedirectToAction("Index", "License");
    }

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        if (!await AllowsPlanManagementAsync(ct)) return NotLicensed();

        var plans = await _db.Plans.AsNoTracking()
            .Include(p => p.Prices)
            .OrderBy(p => p.SortOrder)
            .ToListAsync(ct);
        return View(plans);
    }

    [HttpGet]
    public async Task<IActionResult> Create(CancellationToken ct)
    {
        if (!await AllowsPlanManagementAsync(ct)) return NotLicensed();

        return View(new Plan
        {
            IsActive = true,
            MinPasswordLength = 3,
            SortOrder = 10,
            ShareAllowView = true
        });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(Plan model, CancellationToken ct = default)
    {
        if (!await AllowsPlanManagementAsync(ct)) return NotLicensed();

        model.Code = (model.Code ?? "").Trim();
        if (!CodePattern.IsMatch(model.Code))
        {
            ModelState.AddModelError(nameof(model.Code), "Code: start with letter; letters/digits/_ (2–40).");
            return View(model);
        }

        if (await _db.Plans.AnyAsync(p => p.Code == model.Code, ct))
        {
            ModelState.AddModelError(nameof(model.Code), "Code already exists.");
            return View(model);
        }

        NormalizePlan(model);
        _db.Plans.Add(model);
        await _db.SaveChangesAsync(ct);
        TempData["Ok"] = "Plan created.";
        return RedirectToAction(nameof(Index));
    }

    [HttpGet]
    public async Task<IActionResult> Edit(int id, CancellationToken ct)
    {
        if (!await AllowsPlanManagementAsync(ct)) return NotLicensed();

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == id, ct);
        return plan is null ? NotFound() : View(plan);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Edit(int id, Plan model, CancellationToken ct = default)
    {
        if (!await AllowsPlanManagementAsync(ct)) return NotLicensed();

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (plan is null) return NotFound();

        plan.NameFa = model.NameFa?.Trim() ?? plan.NameFa;
        plan.NameEn = model.NameEn?.Trim() ?? plan.NameEn;
        plan.MaxTasks = model.MaxTasks;
        plan.MaxDataSources = model.MaxDataSources;
        plan.MaxProcessSteps = model.MaxProcessSteps;
        // Per-source ceilings. The effective ceiling is these lowered to the signed license's, so an
        // admin can be stricter than the license but never looser.
        plan.MaxSourceRows = model.MaxSourceRows;
        plan.MaxSourceBytes = model.MaxSourceBytes;
        plan.CanPlay = model.CanPlay;
        plan.CanSelector = model.CanSelector;
        plan.CanRecord = model.CanRecord;
        plan.CanSmart = model.CanSmart;
        plan.IsActive = model.IsActive;
        plan.SortOrder = model.SortOrder;
        plan.MinPasswordLength = Math.Clamp(model.MinPasswordLength, 1, 128);
        plan.RequireLetterAndDigit = model.RequireLetterAndDigit;
        plan.AllowSelfUpgrade = model.AllowSelfUpgrade;
        plan.CanShare = model.CanShare;
        plan.CanReceiveShare = model.CanReceiveShare;
        plan.MaxSharesPerTask = model.MaxSharesPerTask;
        plan.ShareAllowView = model.ShareAllowView;
        plan.ShareAllowEdit = model.ShareAllowEdit;
        plan.ShareAllowDelete = model.ShareAllowDelete;
        plan.ShareAllowExecute = model.ShareAllowExecute;
        plan.ShareAllowChangeDataSource = model.ShareAllowChangeDataSource;

        plan.MonthlyPrice = model.MonthlyPrice;
        plan.MonthlyDiscountPercent = ClampPercent(model.MonthlyDiscountPercent);
        plan.YearlyPrice = model.YearlyPrice;
        plan.YearlyDiscountPercent = ClampPercent(model.YearlyDiscountPercent);
        plan.PriceCurrency = string.IsNullOrWhiteSpace(model.PriceCurrency)
            ? plan.PriceCurrency
            : model.PriceCurrency.Trim().ToUpperInvariant();

        await _db.SaveChangesAsync(ct);
        TempData["Ok"] = "Plan saved.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>A discount is a percentage, so anything outside 0–100 is a typo rather than data.</summary>
    private static decimal? ClampPercent(decimal? value)
        => value is null ? null : Math.Clamp(value.Value, 0m, 100m);

    private static void NormalizePlan(Plan model)
    {
        model.NameFa = model.NameFa?.Trim() ?? "";
        model.NameEn = model.NameEn?.Trim() ?? "";
        model.MinPasswordLength = Math.Clamp(model.MinPasswordLength <= 0 ? 3 : model.MinPasswordLength, 1, 128);
        model.MonthlyDiscountPercent = ClampPercent(model.MonthlyDiscountPercent);
        model.YearlyDiscountPercent = ClampPercent(model.YearlyDiscountPercent);
        model.PriceCurrency = string.IsNullOrWhiteSpace(model.PriceCurrency) ? "IRR" : model.PriceCurrency.Trim().ToUpperInvariant();
    }
}
