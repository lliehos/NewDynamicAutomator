using Webautomator.Domain.Enums;

namespace Webautomator.Domain.Entities;

/// <summary>
/// What a customer bought. One revenue path in, one row out — plan subscription, the software
/// package, or a license renewal.
/// </summary>
/// <remarks>
/// A single order table for all three paths rather than three parallel ones. The three differ only
/// in WHAT is being sold (a plan, a package, a license); the lifecycle — create, pay, activate,
/// maybe refund — is identical, and so is the financial history the customer wants to see. Three
/// tables would have meant three pages, three histories and three ways for the totals to disagree.
/// </remarks>
public class Order
{
    public long Id { get; set; }

    /// <summary>Who is buying. Null only for an abandoned checkout that never identified a user.</summary>
    public int? UserId { get; set; }

    /// <summary>Which of the three revenue paths this order belongs to.</summary>
    public OrderKind Kind { get; set; }

    /// <summary>Pending → Paid → Fulfilled, or Failed/Cancelled. Money is only ever taken on Pending.</summary>
    public OrderStatus Status { get; set; } = OrderStatus.Pending;

    /// <summary>
    /// What was sold, in the form the kind needs: a plan code, a package build id, a license term.
    /// </summary>
    /// <remarks>
    /// Kept as a string because the three kinds reference three different tables. A single nullable
    /// FK column per kind would have been three columns that are never all used, and a polymorphic
    /// FK is not expressible in the schema anyway. The DTO that reads this knows which kind it is.
    /// </remarks>
    public string ItemRef { get; set; } = string.Empty;

    /// <summary>Human-readable item name, snapshotted so history survives a rename or deletion.</summary>
    public string ItemTitle { get; set; } = string.Empty;

    /// <summary>Billing cycle where the kind has one; null otherwise.</summary>
    public string? BillingCycle { get; set; }

    /// <summary>Amount before discount.</summary>
    public decimal Amount { get; set; }
    /// <summary>What the customer actually pays.</summary>
    public decimal PayableAmount { get; set; }
    public decimal? DiscountAmount { get; set; }
    public string Currency { get; set; } = "IRR";

    /// <summary>
    /// The terms this order grants, as JSON.
    /// </summary>
    /// <remarks>
    /// Snapshotted at purchase time on purpose: a price list or feature set edited next month must
    /// not silently change what a customer already bought, and a license built from this order has to
    /// reflect what was true when they paid.
    /// </remarks>
    public string? TermsJson { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? PaidAtUtc { get; set; }
    public DateTime? FulfilledAtUtc { get; set; }

    /// <summary>Reason a failed/cancelled order ended that way, for the history page.</summary>
    public string? FailureReason { get; set; }

    public AppUser? User { get; set; }
    public ICollection<PaymentTransaction> Transactions { get; set; } = new List<PaymentTransaction>();
}

/// <summary>
/// One attempt to pay for an order.
/// </summary>
/// <remarks>
/// Separate from the order because a payment can be attempted more than once — a customer whose
/// gateway session times out tries again, and both attempts belong to the same order. Keeping only
/// the latest attempt on the order would lose the audit trail of what was actually sent to the
/// gateway, which is the first thing needed when a customer says they were charged twice.
/// </remarks>
public class PaymentTransaction
{
    public long Id { get; set; }
    public long OrderId { get; set; }

    /// <summary>Which gateway handled it; a deployment may switch providers between orders.</summary>
    public string Gateway { get; set; } = "manual";

    /// <summary>
    /// The reference the GATEWAY knows. Unique per gateway, which is what makes a repeated callback
    /// idempotent: the second one finds this row instead of paying again.
    /// </summary>
    public string Authority { get; set; } = string.Empty;

    /// <summary>The gateway's own transaction id, once it has one.</summary>
    public string? GatewayReference { get; set; }

    public PaymentStatus Status { get; set; } = PaymentStatus.Initiated;

    public decimal Amount { get; set; }
    public string Currency { get; set; } = "IRR";

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAtUtc { get; set; }

    /// <summary>Raw gateway answer, for support. Not shown to customers.</summary>
    public string? RawResponse { get; set; }

    public Order? Order { get; set; }
}

/// <summary>
/// A priced, configurable software package the customer can buy outright.
/// </summary>
/// <remarks>
/// Distinct from a Plan: a plan is a subscription to use a hosted deployment, while this is the
/// software itself, sold once with the feature set and limits the buyer picked. Its price is
/// therefore computed from its own rules, not from the plan price list — which is why it is its own
/// table rather than another Plan row.
/// </remarks>
public class SoftwarePackageOption
{
    public int Id { get; set; }

    /// <summary>Stable key used in the wizard and stored in the order's terms.</summary>
    public string Key { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }

    /// <summary>
    /// How this option affects the price. A feature that is included raises the price; a limit raises
    /// it per unit, which is what lets "up to N users" be priced without a row per N.
    /// </summary>
    public PackageOptionKind Kind { get; set; }

    /// <summary>Flat amount added when selected (for <see cref="PackageOptionKind.Feature"/>).</summary>
    public decimal Amount { get; set; }

    /// <summary>Amount added per unit (for <see cref="PackageOptionKind.Limit"/>).</summary>
    public decimal UnitAmount { get; set; }

    /// <summary>Included units before <see cref="UnitAmount"/> starts applying.</summary>
    public int IncludedUnits { get; set; }

    /// <summary>Hard ceiling on units, so a buyer cannot price an unsellable package. Null = no cap.</summary>
    public int? MaxUnits { get; set; }

    /// <summary>The unit shown in the wizard ("کاربر", "منبع", …).</summary>
    public string? UnitLabel { get; set; }

    /// <summary>Whether this option is on by default in the wizard.</summary>
    public bool IsDefault { get; set; }

    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
