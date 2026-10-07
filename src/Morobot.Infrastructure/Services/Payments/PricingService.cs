using System.Text.Json.Nodes;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Services.Payments;

/// <summary>One computed line of a price, so the wizard can show HOW the total was reached.</summary>
public sealed record PriceLine(string Key, string Title, decimal Amount, string? Detail);

/// <summary>A computed price: the total plus the lines that produced it.</summary>
public sealed record PriceQuote(decimal Total, string Currency, IReadOnlyList<PriceLine> Lines)
{
    /// <summary>The shape stored on the order's terms, so a later reader sees what was quoted.</summary>
    public JsonObject ToTerms() => new()
    {
        ["total"] = Total,
        ["currency"] = Currency,
        ["lines"] = new JsonArray(Lines.Select(l => (JsonNode)new JsonObject
        {
            ["key"] = l.Key,
            ["title"] = l.Title,
            ["amount"] = l.Amount,
            ["detail"] = l.Detail
        }).ToArray())
    };
}

/// <summary>
/// Turns a chosen feature set into a price.
/// </summary>
/// <remarks>
/// Kept apart from <see cref="CheckoutService"/> on purpose: the checkout moves money and must never
/// guess, while this only does arithmetic on a price list. Separating them means the pricing rules
/// can be read, tested and changed without touching the money path.
///
/// Prices are decimal throughout. A price computed in floating point eventually shows the customer a
/// total that does not match the line items, and a receipt has to add up.
/// </remarks>
public class PricingService
{
    private readonly AppDbContext _db;

    public PricingService(AppDbContext db) => _db = db;

    // ---- Plans --------------------------------------------------------------------------------

    /// <summary>The active plans a customer can buy, with their cycle prices.</summary>
    public async Task<List<Plan>> ListPurchasablePlansAsync(CancellationToken ct = default)
        => await _db.Plans.AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.SortOrder)
            .ToListAsync(ct);

    public static decimal? PriceFor(Plan plan, string cycle) => cycle switch
    {
        "yearly" => plan.YearlyPrice,
        "monthly" => plan.MonthlyPrice,
        _ => null
    };

    public static decimal? DiscountFor(Plan plan, string cycle) => cycle switch
    {
        "yearly" => plan.YearlyDiscountPercent,
        "monthly" => plan.MonthlyDiscountPercent,
        _ => null
    };

    /// <summary>
    /// Price a plan for a cycle.
    /// </summary>
    /// <remarks>
    /// The stored amount IS the charged amount; the discount percentage is what the page advertises
    /// as the saving. Deriving the charge from the percentage instead would make the page able to
    /// contradict its own price after a rounding difference, so the amount always wins.
    /// </remarks>
    public static PriceQuote QuotePlan(Plan plan, string cycle)
    {
        var amount = PriceFor(plan, cycle) ?? 0m;
        var label = string.IsNullOrWhiteSpace(plan.NameFa) ? plan.NameEn : plan.NameFa;
        var lines = new List<PriceLine>
        {
            new(plan.Code, string.IsNullOrWhiteSpace(label) ? plan.Code : label, amount, cycle == "yearly" ? "سالانه" : "ماهانه")
        };
        var discount = DiscountFor(plan, cycle);
        if (discount is > 0)
            lines.Add(new("discount", "تخفیف", 0m, $"{discount:0.##}%"));
        return new PriceQuote(amount, plan.PriceCurrency, lines);
    }

    // ---- Software package ---------------------------------------------------------------------

    public async Task<List<SoftwarePackageOption>> ListPackageOptionsAsync(CancellationToken ct = default)
        => await _db.SoftwarePackageOptions.AsNoTracking()
            .Where(o => o.IsActive)
            .OrderBy(o => o.SortOrder)
            .ToListAsync(ct);

    /// <summary>
    /// Price a software package from the options the buyer selected.
    /// </summary>
    /// <param name="selectedUnits">
    /// Per option key, the number of units chosen. A featured option ignores this; a limit option
    /// is priced as (units − included) × unit price, never below zero, so an option included in the
    /// base cannot produce a negative line.
    /// </param>
    public static PriceQuote QuotePackage(
        IReadOnlyList<SoftwarePackageOption> options,
        IReadOnlyDictionary<string, int> selectedUnits,
        string currency = "IRR")
    {
        var lines = new List<PriceLine>();
        foreach (var option in options)
        {
            if (!selectedUnits.TryGetValue(option.Key, out var units)) continue;
            if (option.Kind == PackageOptionKind.Feature)
            {
                if (units <= 0) continue;
                lines.Add(new(option.Key, option.Title, option.Amount, null));
                continue;
            }

            var chargeable = Math.Max(0, units - option.IncludedUnits);
            var amount = chargeable * option.UnitAmount;
            var detail = chargeable == 0
                ? $"تا {option.IncludedUnits} {option.UnitLabel ?? "واحد"} شامل"
                : $"{chargeable} × {option.UnitAmount:0,0} {option.UnitLabel ?? "واحد"}";
            lines.Add(new(option.Key, option.Title, amount, detail));
        }
        return new PriceQuote(lines.Sum(l => l.Amount), currency, lines);
    }

    // ---- License ------------------------------------------------------------------------------

    /// <summary>The single pricing row, created with defaults on first read so the admin page has something to edit.</summary>
    public async Task<LicensePricing> GetLicensePricingAsync(CancellationToken ct = default)
    {
        var row = await _db.LicensePricings.FirstOrDefaultAsync(ct);
        if (row is not null) return row;
        row = new LicensePricing();
        _db.LicensePricings.Add(row);
        await _db.SaveChangesAsync(ct);
        return row;
    }

    /// <summary>
    /// Price a license term for a user count.
    /// </summary>
    /// <remarks>
    /// The included-user allowance is subtracted before the per-user rate applies, which is what lets
    /// a small deployment buy at the base price instead of being charged from one user up. The term
    /// multiplier then applies to the whole user-priced total, so a perpetual license costs a
    /// multiple of the monthly-equivalent, not a multiple of the base alone.
    /// </remarks>
    public static PriceQuote QuoteLicense(LicensePricing pricing, int users, string term)
    {
        users = Math.Max(1, users);
        if (pricing.MaxUsers is int cap && users > cap) users = cap;

        var extraUsers = Math.Max(0, users - pricing.IncludedUsers);
        var userAmount = extraUsers * pricing.PerUserAmount;
        var monthly = pricing.BaseAmount + userAmount;

        var multiplier = term switch
        {
            "yearly" => pricing.YearlyTermMultiplier,
            "perpetual" => pricing.PerpetualMultiplier,
            _ => 1m
        };
        var termLabel = term switch
        {
            "yearly" => "سالانه",
            "perpetual" => "دائمی",
            _ => "ماهانه"
        };

        var lines = new List<PriceLine>
        {
            new("base", "پایهٔ لایسنس", pricing.BaseAmount, $"تا {pricing.IncludedUsers} کاربر"),
            new("users", $"کاربران ({users})", userAmount, extraUsers == 0 ? "داخل حد پایه" : $"{extraUsers} کاربر اضافه")
        };
        if (multiplier != 1m)
            lines.Add(new("term", $"ضریب دورهٔ {termLabel}", 0m, $"× {multiplier:0.##}"));

        return new PriceQuote(decimal.Round(monthly * multiplier, 0), pricing.Currency, lines);
    }
}
