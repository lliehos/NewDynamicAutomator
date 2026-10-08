namespace Webautomator.Licensing;

public enum LicenseRuntimeMode
{
    NotApplicable = 0,
    Trial = 1,
    Licensed = 2,
    Restricted = 3
}

public enum LicenseRestrictionReason
{
    None = 0,
    TrialExpired = 1,
    LicenseMissing = 2,
    LicenseExpired = 3,
    LicenseInvalid = 4,
    HostMismatch = 5
}

public sealed class LicenseRuntimeState
{
    /// <summary>
    /// Ceiling a trial gets when the signed payload does not name one. The point of a trial cap is
    /// to show the workflow works without becoming a free bulk-import tool, so it is deliberately
    /// small; a licensed payload overrides both values.
    /// </summary>
    public const int DefaultTrialMaxSourceRows = 10;
    public const long DefaultTrialMaxSourceBytes = 500 * 1024;

    public LicenseRuntimeMode Mode { get; init; }
    public LicenseRestrictionReason Reason { get; init; }
    public LicensePayload? Payload { get; init; }
    public int? TrialDaysRemaining { get; init; }
    public bool ShowCopyright => Mode is LicenseRuntimeMode.Trial or LicenseRuntimeMode.Restricted;
    public bool FullFeatures => Mode is LicenseRuntimeMode.Trial or LicenseRuntimeMode.Licensed;
    public bool ViewOnly => Mode == LicenseRuntimeMode.Restricted;
    public bool AllowsUpdates => Mode == LicenseRuntimeMode.Licensed && (Payload?.AllowUpdates ?? false);
    public bool AllowsBranding => Mode == LicenseRuntimeMode.Licensed;
    /// <summary>
    /// Legacy-DB migration must be granted explicitly in the signed license.
    /// Without a payload (trial / restricted / cloud) it stays unavailable.
    /// </summary>
    public bool AllowsLegacyMigration => Mode == LicenseRuntimeMode.Licensed && (Payload?.AllowLegacyMigration ?? false);

    /// <summary>
    /// Whether the deployment may define and assign its own user plan levels.
    /// </summary>
    /// <remarks>
    /// A TRIAL has no plan management: there is no signed payload to carry the permission, and the
    /// trial is meant to demonstrate the product rather than let an install configure its own
    /// commercial tiers before buying. A trial therefore behaves exactly like a licence that turned
    /// the option off — every user sits at the top level, which is also what makes the trial show
    /// the product's full capability.
    /// </remarks>
    public bool AllowsPlanManagement => Mode == LicenseRuntimeMode.Licensed && (Payload?.AllowPlanManagement ?? true);

    /// <summary>
    /// Whether both languages are available.
    /// </summary>
    /// <remarks>
    /// A TRIAL is bilingual: the trial exists to show what the product does, and the second language
    /// is part of what it does. Only a signed licence can restrict the install to one language.
    /// </remarks>
    public bool AllowsBilingual => Mode switch
    {
        LicenseRuntimeMode.Licensed => Payload?.AllowBilingual ?? true,
        LicenseRuntimeMode.Trial => true,
        // A restricted install is view-only; it keeps the shipped behaviour so nothing about the
        // interface changes while the customer is sorting out their licence.
        _ => true
    };

    /// <summary>
    /// Whether the front-end package (the public site) is active for this deployment.
    /// </summary>
    /// <remarks>
    /// Strictly <see cref="LicenseRuntimeMode.Licensed"/>-only, with no trial fallback: the package
    /// is a separately sold bundle rather than a feature of the product, so an install that has not
    /// bought it — including a trial, and including a restricted install whose licence lapsed —
    /// stays panel-first. A registry-style <c>Front.Page</c> override can still force either landing
    /// page, but that is an operator's decision and not something the licence grants.
    /// </remarks>
    public bool AllowsFrontPackage => Mode == LicenseRuntimeMode.Licensed && (Payload?.AllowFrontPackage ?? false);

    /// <summary>
    /// Whether this deployment may run processes locally (the desktop runner and the per-process
    /// "run on server" switch being off).
    /// </summary>
    /// <remarks>
    /// Strictly <see cref="LicenseRuntimeMode.Licensed"/>-only, like <see cref="AllowsFrontPackage"/>
    /// and for the same reason: local execution moves work off the server, so it is a capability the
    /// vendor grants rather than one a trial or a lapsed install should be able to exercise.
    /// </remarks>
    public bool AllowsLocalRun => Mode == LicenseRuntimeMode.Licensed && (Payload?.AllowLocalRun ?? false);

    /// <summary>Whether this deployment may sell plans, packages and licenses (see LicensePayload).</summary>
    public bool AllowsCommerce => Mode == LicenseRuntimeMode.Licensed && (Payload?.AllowCommerce ?? false);

    /// <summary>Whether the software package itself may be sold, as opposed to only plans.</summary>
    public bool AllowsSoftwarePurchase =>
        AllowsCommerce && (Payload?.AllowSoftwarePurchase ?? false);

    /// <summary>Whether the panel may issue its own licenses after payment.</summary>
    public bool AllowsSelfIssuedLicenses =>
        AllowsCommerce && (Payload?.AllowSelfIssuedLicenses ?? false);

    /// <summary>
    /// Whether one account may hold only one signed-in device at a time.
    /// </summary>
    /// <remarks>
    /// Tied to <see cref="AllowsCommerce"/> rather than being its own flag, because it exists for one
    /// reason: on a deployment that SELLS seats, a single purchased account shared among an office is
    /// the whole revenue model defeated. A deployment that sells nothing has no seat to protect, so
    /// imposing a single-device rule there would be an obstacle with no purpose — which is why this
    /// is derived rather than separately granted.
    /// </remarks>
    public bool EnforcesSingleSession => AllowsCommerce;

    /// <summary>
    /// Row ceiling implied by the license. A trial or restricted install falls back to the small
    /// trial cap; a licensed install uses the signed value (null = the vendor sold no ceiling).
    /// </summary>
    public int? MaxSourceRows => Mode switch
    {
        LicenseRuntimeMode.Licensed => Payload?.MaxSourceRows,
        LicenseRuntimeMode.Trial => Payload?.MaxSourceRows ?? DefaultTrialMaxSourceRows,
        // A restricted install is view-only; keep the trial cap so it cannot be used as a free tier.
        LicenseRuntimeMode.Restricted => Payload?.MaxSourceRows ?? DefaultTrialMaxSourceRows,
        _ => null
    };

    /// <summary>Byte ceiling implied by the license — same fallback rules as <see cref="MaxSourceRows"/>.</summary>
    public long? MaxSourceBytes => Mode switch
    {
        LicenseRuntimeMode.Licensed => Payload?.MaxSourceBytes,
        LicenseRuntimeMode.Trial => Payload?.MaxSourceBytes ?? DefaultTrialMaxSourceBytes,
        LicenseRuntimeMode.Restricted => Payload?.MaxSourceBytes ?? DefaultTrialMaxSourceBytes,
        _ => null
    };

    public static LicenseRuntimeState Cloud() => new()
    {
        Mode = LicenseRuntimeMode.NotApplicable,
        Reason = LicenseRestrictionReason.None
    };

    public static LicenseRuntimeState Trial(int daysRemaining, LicensePayload? defaults = null) => new()
    {
        Mode = LicenseRuntimeMode.Trial,
        Reason = LicenseRestrictionReason.None,
        TrialDaysRemaining = daysRemaining,
        Payload = defaults
    };

    public static LicenseRuntimeState Licensed(LicensePayload payload) => new()
    {
        Mode = LicenseRuntimeMode.Licensed,
        Reason = LicenseRestrictionReason.None,
        Payload = payload
    };

    public static LicenseRuntimeState Restricted(LicenseRestrictionReason reason, LicensePayload? payload = null) => new()
    {
        Mode = LicenseRuntimeMode.Restricted,
        Reason = reason,
        Payload = payload
    };
}
