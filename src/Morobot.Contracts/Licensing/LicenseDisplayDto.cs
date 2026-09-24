namespace Morobot.Contracts.Licensing;

public sealed class LicenseDisplayDto
{
    public bool LicensingEnabled { get; set; }
    public string RuntimeMode { get; set; } = "NotApplicable";
    public string Status { get; set; } = "NotRequired";
    public string? StatusMessage { get; set; }
    public string? OrganizationName { get; set; }
    public string? LicenseIdShort { get; set; }
    public DateTime? IssuedAtUtc { get; set; }
    public DateTime? ValidUntilUtc { get; set; }
    public int? MaxUsers { get; set; }
    public int ActiveUserCount { get; set; }
    public long? Sequence { get; set; }
    public string? DeploymentAnchorShort { get; set; }
    public string? ServerFingerprintShort { get; set; }
    public int? DaysRemaining { get; set; }
    public int? TrialDaysRemaining { get; set; }
    /// <summary>End of current trial or licensed period (UTC).</summary>
    public DateTime? ValidityEndsAtUtc { get; set; }
    /// <summary>Start of trial (anchor) or license issue time (UTC).</summary>
    public DateTime? ValidityStartsAtUtc { get; set; }
    public bool AllowUpdates { get; set; }
    /// <summary>Vendor-granted ability to import a legacy database (default off).</summary>
    public bool AllowLegacyMigration { get; set; }
    public bool ShowCopyright { get; set; }
    public string? DatabaseServerHint { get; set; }
    public string? UpdateServerUrl { get; set; }
    public string? PendingConnectionRestart { get; set; }
    public string? AllowedHost { get; set; }
}

public sealed class TenantBrandingDto
{
    public string AppName { get; set; } = "Morobot";
    public string BrandTitle { get; set; } = "Morobot";
    public string? OrganizationName { get; set; }
    public string? LogoUrl { get; set; }
    public string? FaviconUrl { get; set; }
    public bool IsLicensedBranding { get; set; }

    public string ColorPrimary { get; set; } = BrandPaletteDefaults.Primary;
    public string ColorPrimaryDark { get; set; } = BrandPaletteDefaults.PrimaryDark;
    public string ColorPrimaryLight { get; set; } = BrandPaletteDefaults.PrimaryLight;
    public string ColorAccent { get; set; } = BrandPaletteDefaults.Accent;
    public string ColorSoft { get; set; } = BrandPaletteDefaults.Soft;
    public string ColorSoft2 { get; set; } = BrandPaletteDefaults.Soft2;
    public string ColorInk { get; set; } = BrandPaletteDefaults.Ink;
    public string ColorBorderSubtle { get; set; } = BrandPaletteDefaults.BorderSubtle;

    /// <summary>Panel referral QR widget (morobot.ir). Enterprise can disable when licensed.</summary>
    public bool ShowReferralQrWidget { get; set; } = true;
}

public sealed class UpdateCheckResultDto
{
    public bool Allowed { get; set; }
    public bool CheckedOnline { get; set; }
    public string CurrentVersion { get; set; } = "";
    public string? AvailableVersion { get; set; }
    public string? ReleaseNotes { get; set; }
    public string? DownloadUrl { get; set; }
    public DateTime? LastCheckUtc { get; set; }
    public string? Message { get; set; }
}
