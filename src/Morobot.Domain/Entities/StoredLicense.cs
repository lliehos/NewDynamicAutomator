namespace Morobot.Domain.Entities;

/// <summary>Latest imported signed license document. Replacing this row never deletes user/process data.</summary>
public class StoredLicense
{
    public int Id { get; set; }
    public string RawJson { get; set; } = string.Empty;
    public string LicenseId { get; set; } = string.Empty;
    public long Sequence { get; set; }
    public DateTime ValidUntilUtc { get; set; }
    public int? MaxUsers { get; set; }
    public string? OrganizationName { get; set; }
    public bool AllowUpdates { get; set; } = true;
    /// <summary>Vendor-granted ability to import a legacy database (default off).</summary>
    public bool AllowLegacyMigration { get; set; }
    public int TrialDays { get; set; } = 3;
    public string? DatabaseServerHint { get; set; }
    public string? AllowedHost { get; set; }
    /// <summary>Signed referral-widget link; null = use the page compiled into the app.</summary>
    public string? ReferralWidgetUrl { get; set; }
    public DateTime ImportedAtUtc { get; set; }
}
