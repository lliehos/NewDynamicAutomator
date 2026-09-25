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
    /// Which identity store signs users in. "Local" = the built-in user table (the only option
    /// before this existed, so it is the default and an untouched install keeps behaving). "Ldap"
    /// = an external directory; the local table then keeps the roles and plan data while the
    /// directory decides who may sign in.
    /// </summary>
    public const string AuthMode = "AuthMode";
    /// <summary>Directory host name or IP, without a scheme or port.</summary>
    public const string LdapHost = "LdapHost";
    public const string LdapPort = "LdapPort";
    /// <summary>Base DN searches start from, e.g. "DC=corp,DC=local".</summary>
    public const string LdapBaseDn = "LdapBaseDn";
    /// <summary>Bind DN used to search the directory when anonymous binding is not allowed.</summary>
    public const string LdapBindDn = "LdapBindDn";
    /// <summary>
    /// Bind password. Sensitive: the settings page shows it masked and leaving the field untouched
    /// keeps the stored value, so re-saving the form cannot blank a working configuration.
    /// </summary>
    public const string LdapBindPassword = "LdapBindPassword";
    /// <summary>Template that turns the typed user name into a DN, e.g. "{0}@corp.local".</summary>
    public const string LdapUserTemplate = "LdapUserTemplate";
    /// <summary>"true" when the connection must use TLS (ldaps or StartTLS).</summary>
    public const string LdapUseTls = "LdapUseTls";

    // ── Diagram defaults ──
    // The editor's colours and play defaults were compiled into flow.js, so changing how every
    // new process looks meant a code change and a redeploy. They are settings now: the editor
    // reads them as the starting point for a graph that has no value of its own.

    /// <summary>Stroke colour for an action (step) node.</summary>
    public const string DiagramStepStroke = "DiagramStepStroke";
    /// <summary>Fill colour for an action (step) node.</summary>
    public const string DiagramStepFill = "DiagramStepFill";
    /// <summary>Stroke colour for a condition node.</summary>
    public const string DiagramConditionStroke = "DiagramConditionStroke";
    /// <summary>Fill colour for a condition node.</summary>
    public const string DiagramConditionFill = "DiagramConditionFill";
    /// <summary>Stroke colour for a group node.</summary>
    public const string DiagramGroupStroke = "DiagramGroupStroke";
    /// <summary>Highlight colour used when the player marks an element on the page.</summary>
    public const string DiagramHighlightColor = "DiagramHighlightColor";
    /// <summary>Stroke width of the selector outline drawn while playing.</summary>
    public const string DiagramSelectorLineWidth = "DiagramSelectorLineWidth";
    /// <summary>Default pause between two steps, in milliseconds.</summary>
    public const string DiagramStepDelayMs = "DiagramStepDelayMs";
    /// <summary>Default maximum times a node may be revisited before a loop is declared stuck.</summary>
    public const string DiagramLoopBackLimit = "DiagramLoopBackLimit";
    /// <summary>Default for "continue the run even if an action fails".</summary>
    public const string DiagramIgnorePlayError = "DiagramIgnorePlayError";

    /// <summary>
    /// Per-colour override switches. Each colour above is only applied when its switch is on;
    /// with the switch off the diagram falls back to the built-in default while the stored
    /// colour is left untouched. That distinction is the point: an admin trying a palette can
    /// turn one colour off to compare it, then back on, without losing the value they typed.
    /// </summary>
    public const string DiagramStepStrokeEnabled = "DiagramStepStrokeEnabled";
    public const string DiagramStepFillEnabled = "DiagramStepFillEnabled";
    public const string DiagramConditionStrokeEnabled = "DiagramConditionStrokeEnabled";
    public const string DiagramConditionFillEnabled = "DiagramConditionFillEnabled";
    public const string DiagramGroupStrokeEnabled = "DiagramGroupStrokeEnabled";
    public const string DiagramHighlightColorEnabled = "DiagramHighlightColorEnabled";

    /// <summary>Keys owned by the Diagram group, in the order the editor reads them.</summary>
    public static readonly IReadOnlyList<(string Setting, string EnabledSwitch)> DiagramColorPairs = new[]
    {
        (DiagramStepStroke, DiagramStepStrokeEnabled),
        (DiagramStepFill, DiagramStepFillEnabled),
        (DiagramConditionStroke, DiagramConditionStrokeEnabled),
        (DiagramConditionFill, DiagramConditionFillEnabled),
        (DiagramGroupStroke, DiagramGroupStrokeEnabled),
        (DiagramHighlightColor, DiagramHighlightColorEnabled),
    };

    /// <summary>
    /// Settings holding a hex colour. Admin → Settings renders these with a colour picker; the
    /// set is declared here rather than sniffed from the value so a colour that happens to be
    /// empty still gets the right control.
    /// </summary>
    public static readonly IReadOnlySet<string> ColourKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        DiagramStepStroke,
        DiagramStepFill,
        DiagramConditionStroke,
        DiagramConditionFill,
        DiagramGroupStroke,
        DiagramHighlightColor,
        BrandColorPrimary,
        BrandColorPrimaryDark,
        BrandColorPrimaryLight,
        BrandColorAccent,
        BrandColorSoft,
        BrandColorSoft2,
        BrandColorInk,
        BrandColorBorderSubtle,
    };

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
    /// Keys whose value is a secret. Admin → Settings never renders these back to the browser (a
    /// secret written into the page is one screenshot, one proxy log or one shared screen away
    /// from leaking), and an empty submission keeps the stored value rather than clearing it, so
    /// re-saving the form to change an unrelated field cannot silently break directory sign-in.
    /// </summary>
    public static readonly IReadOnlySet<string> SensitiveForAdmin = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        LdapBindPassword
    };

    /// <summary>True when the value is a secret that must not be rendered back to the browser.</summary>
    public static bool IsSensitiveForAdmin(string? key) =>
        !string.IsNullOrWhiteSpace(key) && SensitiveForAdmin.Contains(key);

    /// <summary>
    /// How each settings group is presented on Admin → Settings: display order plus the locale key
    /// stem used for its title/description/icon. Keeping this here (instead of hard-coding group
    /// names in the view) means a new group only needs a `admin.settings.groups.<localeKey>` entry.
    /// </summary>
    public static readonly IReadOnlyList<SettingGroupInfo> GroupPresentation = new[]
    {
        new SettingGroupInfo("Auth", "auth", "ti-shield-lock", 10),
        new SettingGroupInfo("Updates", "updates", "ti-refresh", 20),
        new SettingGroupInfo("Diagram", "diagram", "ti-hierarchy", 25),
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
