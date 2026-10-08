namespace Webautomator.Domain.Entities;

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
    /// <summary>
    /// Vendor-granted ability to manage user plan levels (default ON, including for licences signed
    /// before the flag existed — see <c>LicensePayload.AllowPlanManagement</c>).
    /// </summary>
    public bool AllowPlanManagement { get; set; } = true;
    /// <summary>
    /// Vendor-granted ability to offer both languages (default ON, including for licences signed
    /// before the flag existed — see <c>LicensePayload.AllowBilingual</c>).
    /// </summary>
    public bool AllowBilingual { get; set; } = true;
    /// <summary>Whether this deployment may sell (plans, package, licenses). Default off.</summary>
    public bool AllowCommerce { get; set; }
    /// <summary>Whether the software package itself may be sold, as opposed to only plans.</summary>
    public bool AllowSoftwarePurchase { get; set; }
    /// <summary>Whether the panel may issue its own licenses after payment.</summary>
    public bool AllowSelfIssuedLicenses { get; set; }
    /// <summary>The signed public base URL of the server this licence was issued for.</summary>
    public string? ServerBaseUrl { get; set; }
    public int TrialDays { get; set; } = 10;
    public string? DatabaseServerHint { get; set; }
    public string? AllowedHost { get; set; }
    /// <summary>Signed referral-widget link; null = use the page compiled into the app.</summary>
    public string? ReferralWidgetUrl { get; set; }
    public DateTime ImportedAtUtc { get; set; }
}
