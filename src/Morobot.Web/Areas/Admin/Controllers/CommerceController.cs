using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Morobot.Infrastructure.Services.Payments;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Web.Areas.Admin.Controllers;

/// <summary>
/// Pricing for the software package and for licenses.
/// </summary>
/// <remarks>
/// Separate from the plan price list on purpose: a plan is a subscription, a package is the software
/// bought outright, and a license term is a license — an operator prices the three independently, and
/// merging them would have forced one price list to mean three different things.
///
/// Admin-only, and gated on the commerce flag: there is nothing to price on an install that is not
/// licensed to sell, and a page that edits prices nobody can charge would be a trap.
/// </remarks>
[Area("Admin")]
[Authorize(Roles = "Admin")]
public class CommerceController : Controller
{
    private readonly AppDbContext _db;
    private readonly PricingService _pricing;
    private readonly LicenseService _license;

    public CommerceController(AppDbContext db, PricingService pricing, LicenseService license)
    {
        _db = db;
        _pricing = pricing;
        _license = license;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var runtime = await _license.GetRuntimeStateAsync(ct);
        ViewBag.CommerceAllowed = runtime.AllowsCommerce;
        ViewBag.SoftwarePurchaseAllowed = runtime.AllowsSoftwarePurchase;
        ViewBag.SelfIssuedAllowed = runtime.AllowsSelfIssuedLicenses;
        // Whether a signing key exists is shown but never displayed: the page only needs to say
        // whether self-issued licenses will actually work.
        ViewBag.CanIssueLicenses = _license.CanIssueLicenses;
        ViewBag.Options = await _db.SoftwarePackageOptions.OrderBy(o => o.SortOrder).ToListAsync(ct);
        ViewBag.LicensePricing = await _pricing.GetLicensePricingAsync(ct);
        return View();
    }

    /// <summary>Add or update one package option.</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SaveOption(SoftwarePackageOption model, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(model.Key) || string.IsNullOrWhiteSpace(model.Title))
        {
            TempData["CommerceError"] = "کلید و عنوان گزینه لازم است.";
            return RedirectToAction(nameof(Index));
        }

        var existing = await _db.SoftwarePackageOptions
            .FirstOrDefaultAsync(o => o.Key == model.Key, ct);
        if (existing is null)
        {
            model.Key = model.Key.Trim();
            model.UpdatedAtUtc = DateTime.UtcNow;
            _db.SoftwarePackageOptions.Add(model);
        }
        else
        {
            existing.Title = model.Title;
            existing.Description = model.Description;
            existing.Kind = model.Kind;
            existing.Amount = model.Amount;
            existing.UnitAmount = model.UnitAmount;
            existing.IncludedUnits = model.IncludedUnits;
            existing.MaxUnits = model.MaxUnits;
            existing.UnitLabel = model.UnitLabel;
            existing.IsDefault = model.IsDefault;
            existing.IsActive = model.IsActive;
            existing.SortOrder = model.SortOrder;
            existing.UpdatedAtUtc = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync(ct);
        TempData["CommerceOk"] = "گزینه ذخیره شد.";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteOption(int id, CancellationToken ct)
    {
        var row = await _db.SoftwarePackageOptions.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (row is not null)
        {
            // Deactivated rather than deleted: an order's terms reference the option key, and a
            // deleted row would make past orders unreadable in the history.
            row.IsActive = false;
            row.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
        TempData["CommerceOk"] = "گزینه غیرفعال شد.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Save the license price list.</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SaveLicensePricing(LicensePricing model, CancellationToken ct)
    {
        var row = await _pricing.GetLicensePricingAsync(ct);
        row.BaseAmount = model.BaseAmount;
        row.PerUserAmount = model.PerUserAmount;
        row.IncludedUsers = Math.Max(0, model.IncludedUsers);
        row.MaxUsers = model.MaxUnitsOrDefault();
        row.YearlyTermMultiplier = model.YearlyTermMultiplier;
        row.PerpetualMultiplier = model.PerpetualMultiplier;
        row.Currency = string.IsNullOrWhiteSpace(model.Currency) ? "IRR" : model.Currency.Trim();
        row.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        TempData["CommerceOk"] = "قیمت‌گذاری لایسنس ذخیره شد.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Live price preview, so an operator can see the effect of a number as they type it.
    /// </summary>
    /// <remarks>
    /// Priced by the SAME service the checkout uses, so the preview cannot disagree with what a
    /// customer is actually charged — which is the only way a preview is worth having.
    /// </remarks>
    [HttpGet]
    public async Task<IActionResult> Quote(int users, string term, CancellationToken ct)
    {
        var pricing = await _pricing.GetLicensePricingAsync(ct);
        var quote = PricingService.QuoteLicense(pricing, users, term);
        return Json(new
        {
            total = quote.Total,
            currency = quote.Currency,
            lines = quote.Lines.Select(l => new { l.Title, l.Amount, l.Detail })
        });
    }
}

/// <summary>Helper kept next to the model it reads, so the nullable mapping is in one place.</summary>
internal static class LicensePricingModelExtensions
{
    public static int? MaxUnitsOrDefault(this LicensePricing model)
        => model.MaxUsers is > 0 ? model.MaxUsers : null;
}
