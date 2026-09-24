namespace Morobot.Domain;

public static class SystemSettingKeys
{
    public const string DefaultRegisterPlan = "DefaultRegisterPlan";
    public const string LicensedDatabaseConnection = "LicensedDatabaseConnection";
    public const string PendingConnectionRestart = "PendingConnectionRestart";
    public const string UpdateServerUrl = "UpdateServerUrl";
    public const string UpdateLastCheckUtc = "UpdateLastCheckUtc";
    public const string UpdateAvailableVersion = "UpdateAvailableVersion";
    public const string UpdateAvailableNotes = "UpdateAvailableNotes";
    public const string UpdateAvailableUrl = "UpdateAvailableUrl";
    public const string BrandAppName = "BrandAppName";
    public const string BrandTitle = "BrandTitle";
    public const string BrandOrganization = "BrandOrganization";
    public const string BrandLogoPath = "BrandLogoPath";
    public const string BrandFaviconPath = "BrandFaviconPath";
    public const string BrandColorPrimary = "BrandColorPrimary";
    public const string BrandColorPrimaryDark = "BrandColorPrimaryDark";
    public const string BrandColorPrimaryLight = "BrandColorPrimaryLight";
    public const string BrandColorAccent = "BrandColorAccent";
    public const string BrandColorSoft = "BrandColorSoft";
    public const string BrandColorSoft2 = "BrandColorSoft2";
    public const string BrandColorInk = "BrandColorInk";
    public const string BrandColorBorderSubtle = "BrandColorBorderSubtle";
    public const string BrandReferralQrVisible = "BrandReferralQrVisible";

    /// <summary>
    /// Keys owned by Admin → Branding. Admin → Settings must NOT list these: both pages read and
    /// write the same rows, so exposing them in two places let a stale Settings form silently
    /// overwrite branding (or vice versa). Branding values are also licence-gated and need the
    /// dedicated editor with its colour pickers and image uploads.
    /// </summary>
    public static readonly IReadOnlySet<string> BrandingOwned = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        BrandAppName,
        BrandTitle,
        BrandOrganization,
        BrandLogoPath,
        BrandFaviconPath,
        BrandColorPrimary,
        BrandColorPrimaryDark,
        BrandColorPrimaryLight,
        BrandColorAccent,
        BrandColorSoft,
        BrandColorSoft2,
        BrandColorInk,
        BrandColorBorderSubtle,
        BrandReferralQrVisible
    };

    /// <summary>True when the key belongs to a page other than Admin → Settings.</summary>
    public static bool IsBrandingOwned(string? key) =>
        !string.IsNullOrWhiteSpace(key) && BrandingOwned.Contains(key);
}
