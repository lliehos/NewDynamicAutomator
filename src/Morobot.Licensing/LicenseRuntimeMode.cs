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
    LicenseInvalid = 4
}

public sealed class LicenseRuntimeState
{
    public LicenseRuntimeMode Mode { get; init; }
    public LicenseRestrictionReason Reason { get; init; }
    public LicensePayload? Payload { get; init; }
    public int? TrialDaysRemaining { get; init; }
    public bool ShowCopyright => Mode is LicenseRuntimeMode.Trial or LicenseRuntimeMode.Restricted;
    public bool FullFeatures => Mode is LicenseRuntimeMode.Trial or LicenseRuntimeMode.Licensed;
    public bool ViewOnly => Mode == LicenseRuntimeMode.Restricted;
    public bool AllowsUpdates => Mode == LicenseRuntimeMode.Licensed && (Payload?.AllowUpdates ?? false);
    public bool AllowsBranding => Mode == LicenseRuntimeMode.Licensed;

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
