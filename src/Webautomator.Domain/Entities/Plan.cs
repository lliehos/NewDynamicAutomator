using Webautomator.Domain.Enums;

namespace Webautomator.Domain.Entities;

public class Plan
{
    public int Id { get; set; }
    /// <summary>Stable key e.g. Local, Free, Pro, Gold (or custom).</summary>
    public string Code { get; set; } = nameof(PlanCode.Free);
    public string NameFa { get; set; } = string.Empty;
    public string NameEn { get; set; } = string.Empty;
    /// <summary>Null = unlimited.</summary>
    public int? MaxTasks { get; set; }
    /// <summary>Null = unlimited.</summary>
    public int? MaxDataSources { get; set; }
    /// <summary>Max step/action nodes per process graph. Null = unlimited.</summary>
    public int? MaxProcessSteps { get; set; }
    /// <summary>
    /// Most rows one data source may hold on this plan. Null = unlimited. The admin sets this, but
    /// the effective ceiling is always the lower of this and the signed license's cap.
    /// </summary>
    public int? MaxSourceRows { get; set; }
    /// <summary>
    /// Largest content (bytes) one data source may hold on this plan. Null = unlimited. Same
    /// license-vs-plan lowering rule as <see cref="MaxSourceRows"/>.
    /// </summary>
    public long? MaxSourceBytes { get; set; }
    public bool CanPlay { get; set; }
    public bool CanSelector { get; set; }
    public bool CanRecord { get; set; }
    public bool CanSmart { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }

    // ── Pricing ──
    // A plan carries its own two prices rather than a list of PlanPrice rows. The old model allowed
    // any number of prices per plan with a free-text "interval", which is why the separate Prices
    // page existed and why nothing could be shown as a price table: "monthly" was a string someone
    // could spell "Monthly" or "mo", and two rows could both claim to be the monthly price.
    //
    // Monthly and yearly are the only two cycles the product sells, so they are named columns. Null
    // amount = that cycle is not offered, which is different from zero (free).
    //
    // The discount is expressed as a PERCENT rather than as a second amount so the page cannot end
    // up advertising a yearly price that contradicts its own discount. The stored yearly amount is
    // what the customer is charged; the percentage is what the page displays as the saving.

    /// <summary>Price charged per month. Null = no monthly option. Currency is <see cref="PriceCurrency"/>.</summary>
    public decimal? MonthlyPrice { get; set; }
    /// <summary>Discount advertised on the monthly price, as a percentage (0–100).</summary>
    public decimal? MonthlyDiscountPercent { get; set; }
    /// <summary>Price charged per year. Null = no yearly option.</summary>
    public decimal? YearlyPrice { get; set; }
    /// <summary>Discount advertised on the yearly price, as a percentage (0–100).</summary>
    public decimal? YearlyDiscountPercent { get; set; }
    /// <summary>ISO code the two prices are stated in.</summary>
    public string PriceCurrency { get; set; } = "IRR";

    /// <summary>Minimum password length required for this plan.</summary>
    public int MinPasswordLength { get; set; } = 3;
    /// <summary>When true, password must include at least one letter and one digit.</summary>
    public bool RequireLetterAndDigit { get; set; }
    /// <summary>User may self-upgrade to this plan (subject to password policy).</summary>
    public bool AllowSelfUpgrade { get; set; }

    /// <summary>May share processes with other users (not Local/guest).</summary>
    public bool CanShare { get; set; }
    /// <summary>May appear as a share recipient (searchable / grantable).</summary>
    public bool CanReceiveShare { get; set; } = true;
    /// <summary>Null = unlimited recipients per task.</summary>
    public int? MaxSharesPerTask { get; set; }
    public bool ShareAllowView { get; set; } = true;
    public bool ShareAllowEdit { get; set; }
    public bool ShareAllowDelete { get; set; }
    public bool ShareAllowExecute { get; set; }
    public bool ShareAllowChangeDataSource { get; set; }

    public ICollection<PlanPrice> Prices { get; set; } = new List<PlanPrice>();
    public ICollection<AppUser> Users { get; set; } = new List<AppUser>();
}
