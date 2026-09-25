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
    public const string BrandAppNameEn = "BrandAppNameEn";
    public const string BrandAppNameFa = "BrandAppNameFa";
    public const string BrandTitleEn = "BrandTitleEn";
    public const string BrandTitleFa = "BrandTitleFa";
    public const string BrandOrganizationEn = "BrandOrganizationEn";
    public const string BrandOrganizationFa = "BrandOrganizationFa";
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
        BrandAppNameEn,
        BrandAppNameFa,
        BrandTitleEn,
        BrandTitleFa,
        BrandOrganizationEn,
        BrandOrganizationFa,
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

    /// <summary>
    /// Keys that are set by the system itself (background services, licence import) and are only
    /// shown for information. Admin → Settings renders these read-only, because hand-editing them
    /// either does nothing useful or desynchronises the feature that owns them.
    /// </summary>
    public static readonly IReadOnlySet<string> ReadOnlyForAdmin = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        LicensedDatabaseConnection,
        PendingConnectionRestart,
        UpdateLastCheckUtc,
        UpdateAvailableVersion,
        UpdateAvailableNotes,
        UpdateAvailableUrl
    };

    /// <summary>True when the value is system-managed and must not be edited from the settings form.</summary>
    public static bool IsReadOnlyForAdmin(string? key) =>
        !string.IsNullOrWhiteSpace(key) && ReadOnlyForAdmin.Contains(key);

    /// <summary>
    /// How each settings group is presented on Admin → Settings: display order plus the locale key
    /// stem used for its title/description/icon. Keeping this here (instead of hard-coding group
    /// names in the view) means a new group only needs a `admin.settings.groups.<localeKey>` entry.
    /// </summary>
    public static readonly IReadOnlyList<SettingGroupInfo> GroupPresentation = new[]
    {
        new SettingGroupInfo("Auth", "auth", "ti-shield-lock", 10),
        new SettingGroupInfo("Updates", "updates", "ti-refresh", 20),
        new SettingGroupInfo("Deployment", "deployment", "ti-server-cog", 30),
        new SettingGroupInfo("Branding", "branding", "ti-palette", 40)
    };

    /// <summary>Presentation metadata for one settings group.</summary>
    public sealed record SettingGroupInfo(string Name, string LocaleKey, string Icon, int Order)
    {
        /// <summary>Order to render at, falling back to the end for unknown groups.</summary>
        public static int OrderOf(string? group) =>
            GroupPresentation.FirstOrDefault(g => string.Equals(g.Name, group, StringComparison.OrdinalIgnoreCase))?.Order ?? 999;

        /// <summary>Locale key stem, falling back to the raw group name for unknown groups.</summary>
        public static string LocaleKeyOf(string? group) =>
            GroupPresentation.FirstOrDefault(g => string.Equals(g.Name, group, StringComparison.OrdinalIgnoreCase))?.LocaleKey
            ?? (group ?? "").ToLowerInvariant();

        /// <summary>Icon class, falling back to a neutral settings icon.</summary>
        public static string IconOf(string? group) =>
            GroupPresentation.FirstOrDefault(g => string.Equals(g.Name, group, StringComparison.OrdinalIgnoreCase))?.Icon
            ?? "ti-settings";
    }
}
