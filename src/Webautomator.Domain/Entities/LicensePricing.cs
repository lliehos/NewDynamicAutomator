namespace Webautomator.Domain.Entities;

/// <summary>
/// The price configuration used to quote a new license.
/// </summary>
/// <remarks>
/// Separate from <see cref="SoftwarePackageOption"/> because a license is not the same purchase. A
/// package option says what the software DOES; a license term says how long and for how many users
/// it may run. An operator prices the two independently — one-time feature price versus recurring
/// term price — and merging them would have forced one price list to mean two different things.
///
/// Stored as a single row rather than a table of rows: this is a small, deployment-wide price list
/// (a base amount plus per-unit rates), and a configuration page that edits numbers is the whole
/// requirement. A table would add CRUD UI for no gain.
/// </remarks>
public class LicensePricing
{
    public int Id { get; set; }

    /// <summary>Base amount for the shortest term, before any per-unit charge.</summary>
    public decimal BaseAmount { get; set; }

    /// <summary>Amount added per extra user beyond <see cref="IncludedUsers"/>.</summary>
    public decimal PerUserAmount { get; set; }

    /// <summary>Users covered by <see cref="BaseAmount"/>, so a small deployment is not penalised.</summary>
    public int IncludedUsers { get; set; } = 1;

    /// <summary>Hard ceiling on users a single license may be sold for. Null = no cap.</summary>
    public int? MaxUsers { get; set; }

    /// <summary>Multiplier applied to the whole amount for a yearly term, e.g. 10 for "ten months".</summary>
    public decimal YearlyTermMultiplier { get; set; } = 12m;

    /// <summary>Multiplier applied to the whole amount for a perpetual (no-expiry) license.</summary>
    public decimal PerpetualMultiplier { get; set; } = 30m;

    public string Currency { get; set; } = "IRR";

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
