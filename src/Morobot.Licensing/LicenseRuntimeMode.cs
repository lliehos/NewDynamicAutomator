namespace Morobot.Licensing;

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
