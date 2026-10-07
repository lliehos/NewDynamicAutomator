namespace Morobot.Domain.Enums;

/// <summary>The three ways this product earns money.</summary>
/// <remarks>
/// Named for what is sold rather than for the flow, because the flow is shared: all three end in the
/// same checkout, the same gateway callback and the same history page.
/// </remarks>
public enum OrderKind
{
    /// <summary>A subscription to a hosted plan (monthly or yearly).</summary>
    Plan = 1,

    /// <summary>The software itself, bought outright with a chosen feature set and limits.</summary>
    SoftwarePackage = 2,

    /// <summary>A new license for an existing deployment whose license has expired.</summary>
    LicenseRenewal = 3
}

/// <summary>Where an order is in its life.</summary>
/// <remarks>
/// The order of the first three matters: an order only moves forward through them, and anything
/// that checks "has this been paid for?" compares against <see cref="Paid"/> or later.
/// </remarks>
public enum OrderStatus
{
    /// <summary>Created, awaiting payment. Money has not been taken.</summary>
    Pending = 0,

    /// <summary>The gateway confirmed the money. The item is owed to the customer.</summary>
    Paid = 1,

    /// <summary>The item was delivered: the plan enabled, the license issued.</summary>
    Fulfilled = 2,

    /// <summary>Payment failed or the customer abandoned it.</summary>
    Failed = 3,

    /// <summary>Deliberately abandoned before payment.</summary>
    Cancelled = 4
}

/// <summary>State of one gateway attempt.</summary>
public enum PaymentStatus
{
    /// <summary>Sent to the gateway; the customer has not come back yet.</summary>
    Initiated = 0,

    /// <summary>The gateway confirmed the payment.</summary>
    Succeeded = 1,

    /// <summary>The gateway refused it, or the customer cancelled.</summary>
    Failed = 2,

    /// <summary>Started but never completed — the customer closed the page.</summary>
    Abandoned = 3
}

/// <summary>How a purchasable software option affects the computed price.</summary>
public enum PackageOptionKind
{
    /// <summary>A flat amount added when the option is selected.</summary>
    Feature = 1,

    /// <summary>A per-unit amount, applied above the included units.</summary>
    Limit = 2
}
