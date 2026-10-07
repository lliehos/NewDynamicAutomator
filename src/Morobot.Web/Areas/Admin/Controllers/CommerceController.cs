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
    private readonly EventLogService _events;

    public CommerceController(AppDbContext db, PricingService pricing, LicenseService license, EventLogService events)
    {
        _db = db;
        _pricing = pricing;
        _license = license;
        _events = events;
    }

    [HttpGet]
    public async Task<IActionResult> Index(int? edit, CancellationToken ct)
    {
        var runtime = await _license.GetRuntimeStateAsync(ct);
        ViewBag.CommerceAllowed = runtime.AllowsCommerce;
        ViewBag.SoftwarePurchaseAllowed = runtime.AllowsSoftwarePurchase;
        ViewBag.SelfIssuedAllowed = runtime.AllowsSelfIssuedLicenses;
        // Whether a signing key exists is shown but never displayed: the page only needs to say
        // whether self-issued licenses will actually work.
        ViewBag.CanIssueLicenses = _license.CanIssueLicenses;
        // How many rows are still pinned to a different deployment instance, i.e. would be invisible
        // after a move. Surfaced so an operator can see and fix it instead of only reading about it.
        ViewBag.UnboundUsers = await _db.Users.CountAsync(u => u.DeploymentInstanceId == null, ct);
        // Every option, including the inactive ones: the admin page is where an operator re-enables a
        // key they retired, so filtering to active-only (as the buyer-facing list does) would hide the
        // very rows this page exists to manage.
        ViewBag.Options = await _db.SoftwarePackageOptions
            .OrderBy(o => o.SortOrder).ThenBy(o => o.Id).ToListAsync(ct);
        ViewBag.LicensePricing = await _pricing.GetLicensePricingAsync(ct);
        // Which key the inline form should open pre-filled for editing.
        ViewBag.EditingId = edit;
        return View();
    }

    /// <summary>
    /// Re-attach every tenant row to this server's deployment instance.
    /// </summary>
    /// <remarks>
    /// This is what makes the install movable: every user and process row carries the instance it
    /// belongs to, and after a backup is restored on a different machine those instance ids no longer
    /// match, so the rows would be filtered out and the data would appear to have vanished. Importing
    /// a valid licence already rebinds everything, so this exists for the case where the operator
    /// restored a backup without re-importing — the data is there, it just needs pointing at the host
    /// it now lives on.
    /// </remarks>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> RebindHost(CancellationToken ct)
    {
        await _license.RebindAllTenantDataToCurrentDeploymentAsync(ct);
        TempData["CommerceStatus"] = "همهٔ کاربران و فرآیندها به این سرور متصل شدند.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Add or update one package option.</summary>
    /// <remarks>
    /// The posted <see cref="SoftwarePackageOption.Id"/> decides insert vs update, NOT the key. Keying
    /// on the key meant an operator could only ever edit the row whose key they retyped, and renaming
    /// a key silently created a second row instead of changing the first — which is exactly what the
    /// per-key edit button must not do. Key stays immutable after creation because past orders carry
    /// their own terms snapshot, so changing it would decouple history from any future pricing of the
    /// same feature.
    /// </remarks>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SaveOption(SoftwarePackageOption model, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(model.Key) || string.IsNullOrWhiteSpace(model.Title))
        {
            TempData["CommerceError"] = "کلید و عنوان گزینه لازم است.";
            return RedirectToAction(nameof(Index));
        }

        if (model.Id > 0)
        {
            var existing = await _db.SoftwarePackageOptions.FirstOrDefaultAsync(o => o.Id == model.Id, ct);
            if (existing is null)
            {
                TempData["CommerceError"] = "این کلید پیدا نشد.";
                return RedirectToAction(nameof(Index));
            }
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
            await _db.SaveChangesAsync(ct);
            TempData["CommerceOk"] = "کلید به‌روزرسانی شد.";
            return RedirectToAction(nameof(Index));
        }

        var key = model.Key.Trim();
        if (await _db.SoftwarePackageOptions.AnyAsync(o => o.Key == key, ct))
        {
            TempData["CommerceError"] = $"کلید «{key}» از قبل وجود دارد.";
            return RedirectToAction(nameof(Index));
        }

        model.Id = 0;
        model.Key = key;
        model.UpdatedAtUtc = DateTime.UtcNow;
        _db.SoftwarePackageOptions.Add(model);
        await _db.SaveChangesAsync(ct);
        TempData["CommerceOk"] = "کلید اضافه شد.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Hard-delete a package option.
    /// </summary>
    /// <remarks>
    /// A real delete, not a soft retire: the operator asked to remove the key, and leaving a row
    /// behind that the buyer never sees only makes the admin list lie about what exists. It is safe
    /// because an order stores its own terms JSON — the price and feature set a customer paid for are
    /// snapshotted on the ORDER, not looked up from this table — so removing a key cannot rewrite
    /// history. (Deactivation is still available and is the right choice for "stop selling this": it
    /// keeps the row visible here for a later re-enable.)
    /// </remarks>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteOption(int id, CancellationToken ct)
    {
        var row = await _db.SoftwarePackageOptions.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (row is not null)
        {
            _db.SoftwarePackageOptions.Remove(row);
            await _db.SaveChangesAsync(ct);
            await _events.LogAsync("Audit", "System", "PackageOptionDeleted",
                $"Admin deleted package pricing key '{row.Key}'", userName: User.Identity?.Name, ct: ct);
        }
        TempData["CommerceOk"] = "کلید حذف شد.";
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
