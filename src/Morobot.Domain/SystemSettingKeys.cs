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
    /// Legacy single-choice key, superseded by the two switches below and intentionally not
    /// rendered anywhere. Nothing reads it except <c>AuthModeResolver</c>, which consults it only
    /// when neither switch exists, so an install too old to have been seeded with them still
    /// resolves the way it used to. Kept as a constant purely so that fallback path can name it —
    /// do not add it back to the settings page or to the seeder.
    /// </summary>
    public const string AuthMode = "AuthMode";

    /// <summary>
    /// "true" when the built-in user table may sign users in. Paired with
    /// <see cref="AuthLdapEnabled"/>: the two switches replace the old single-choice AuthMode, and
    /// at least one of them must stay on. Deliberately NOT named "Local" so it does not collide
    /// with the legacy value once stored as a bare string.
    /// </summary>
    public const string AuthLocalEnabled = "AuthLocalEnabled";

    /// <summary>
    /// "true" when an external directory may sign users in. Default is off, so an install that
    /// never configured a directory keeps using the local table only. The two switches are
    /// independent on purpose: an install may accept both, and then whichever provider recognises
    /// the credentials is the one that signs the user in.
    /// </summary>
    public const string AuthLdapEnabled = "AuthLdapEnabled";

    /// <summary>
    /// Keys whose value is a plain "true"/"false" flag. Admin → Settings renders these as a switch
    /// rather than a text box: a free-text field accepting any string invites a typo like "ture",
    /// which \u2014 for a flag the code reads with a strict comparison \u2014 silently means "off".
    /// </summary>
    public static readonly IReadOnlySet<string> BooleanKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        AuthLocalEnabled,
        AuthLdapEnabled,
        LdapUseTls
    };

    /// <summary>True when the setting is a plain on/off flag.</summary>
    public static bool IsBoolean(string? key) =>
        !string.IsNullOrWhiteSpace(key) && BooleanKeys.Contains(key);

    /// <summary>
    /// Keys the Auth group renders, in the order it should read. Alphabetical ordering (the
    /// service's default) put "AuthLdapEnabled" above "AuthLocalEnabled" and scattered the LDAP
    /// connection fields around them, so the switch that governs the directory appeared after the
    /// fields it governs. Listing the order here keeps "provider switches, then the directory
    /// they configure, then the fallback plan" together and reviewable top to bottom.
    /// </summary>
    public static readonly IReadOnlyList<string> AuthGroupOrder = new[]
    {
        AuthLocalEnabled,
        AuthLdapEnabled,
        LdapHost,
        LdapPort,
        LdapDomain,
        LdapNameFormat,
        LdapUseTls,
        DefaultRegisterPlan
    };

    /// <summary>
    /// Settings the Auth group must never render: the legacy AuthMode row offers a second,
    /// contradictory way to choose what the two switches already decide, and the removed directory
    /// keys belong to a search this authenticator does not perform. Filtered out here rather than in
    /// the view so the group's visible count and the page agree.
    /// </summary>
    /// <remarks>
    /// The removed key names are spelled out rather than referencing <see cref="RemovedLdapKeys"/>:
    /// static field initialisers run in declaration order, so a reference to a field declared
    /// further down the file would still be null here.
    /// </remarks>
    public static readonly IReadOnlySet<string> SupersededKeys = new HashSet<string>(
        new[]
        {
            AuthMode,
            "LdapBaseDn",
            "LdapBindDn",
            "LdapBindPassword",
            "LdapUserTemplate"
        },
        StringComparer.OrdinalIgnoreCase);

    /// <summary>True when a key is obsolete and must not be shown on the settings page.</summary>
    public static bool IsSuperseded(string? key) =>
        !string.IsNullOrWhiteSpace(key) && SupersededKeys.Contains(key);

    /// <summary>Where a key sorts inside its group, falling back to the end for anything unlisted.</summary>
    public static int OrderOf(string? group, string? key)
    {
        if (!string.Equals(group, "Auth", StringComparison.OrdinalIgnoreCase)) return 999;
        var index = AuthGroupOrder.ToList().FindIndex(k => string.Equals(k, key, StringComparison.OrdinalIgnoreCase));
        return index < 0 ? 999 : index;
    }

    /// <summary>
    /// Directory keys that were removed because nothing ever read them: the authenticator binds,
    /// it does not search, so a search base and a service account had no effect. Kept as names so
    /// the settings page and the cleanup can recognise and delete stale rows.
    /// </summary>
    /// <remarks>
    /// Declared here, above <see cref="SupersededKeys"/>, because static field initialisers run in
    /// declaration order — referring to this from a field declared earlier would read null.
    /// </remarks>
    public static readonly IReadOnlyList<string> RemovedLdapKeys = new[]
    {
        "LdapBaseDn",
        "LdapBindDn",
        "LdapBindPassword",
        "LdapUserTemplate"
    };

    /// <summary>True when a key is a directory setting that is no longer used.</summary>
    public static bool IsRemovedLdapKey(string? key) =>
        !string.IsNullOrWhiteSpace(key) && RemovedLdapKeys.Contains(key, StringComparer.OrdinalIgnoreCase);

    /// <summary>Directory host name or IP, without a scheme or port.</summary>
    public const string LdapHost = "LdapHost";
    public const string LdapPort = "LdapPort";
    /// <summary>
    /// The AD domain used to qualify the account, e.g. "corp" or "corp.local". Optional: blank
    /// means the part of the host name before the first dot is used, which is right for a normal
    /// on-premises install that points at the domain controller.
    /// </summary>
    public const string LdapDomain = "LdapDomain";
    /// <summary>
    /// Which form of qualified name the directory is given: "DomainBackslash" (DOMAIN\user, the
    /// on-premises AD default) or "UserPrincipalName" (user@domain, the Microsoft 365 form).
    /// </summary>
    public const string LdapNameFormat = "LdapNameFormat";
    /// <summary>
    /// "true" when the connection must be secured with TLS (LDAPS). A simple bind sends the
    /// password, so leaving this off sends it in the clear — the administrator's explicit choice.
    /// </summary>
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
    /// Keys whose value is a secret, so Admin → Settings never renders it back to the browser (a
    /// secret written into the page is one screenshot, one proxy log or one shared screen away from
    /// leaking), and an empty submission keeps the stored value rather than clearing it, so
    /// re-saving the form to change an unrelated field cannot silently wipe it.
    /// </summary>
    /// <remarks>
    /// Empty today: the directory bind password was the only entry, and a simple bind uses the
    /// credentials being checked rather than a stored service account, so there is nothing left to
    /// keep secret. The mechanism stays because the next secret setting will need it.
    /// </remarks>
    public static readonly IReadOnlySet<string> SensitiveForAdmin = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    /// <summary>True when the value is a secret that must not be rendered back to the browser.</summary>
    public static bool IsSensitiveForAdmin(string? key) =>
        !string.IsNullOrWhiteSpace(key) && SensitiveForAdmin.Contains(key);

    /// <summary>
    /// Directory fields that only make sense while the LDAP switch is on. The settings page hides
    /// them when it is off, so the Auth card stays readable for the common local-only install.
    /// </summary>
    public static readonly IReadOnlySet<string> LdapOnlyKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        LdapHost,
        LdapPort,
        LdapDomain,
        LdapNameFormat,
        LdapUseTls
    };

    /// <summary>True when the key belongs to the directory configuration.</summary>
    public static bool IsLdapOnly(string? key) =>
        !string.IsNullOrWhiteSpace(key) && LdapOnlyKeys.Contains(key);

    /// <summary>
    /// The two identity-store switches. At least one must remain on: turning both off would leave
    /// no way to sign in at all, including the administrator who would fix it.
    /// </summary>
    public static readonly IReadOnlyList<string> AuthProviderSwitchKeys = new[] { AuthLocalEnabled, AuthLdapEnabled };

    /// <summary>
    /// Normalises a pair of provider switches so at least one is on. Returns the possibly-corrected
    /// values plus whether a correction was needed, which the caller turns into a warning.
    /// </summary>
    public static (bool local, bool ldap, bool corrected) NormalizeAuthProviders(bool local, bool ldap)
    {
        if (local || ldap) return (local, ldap, false);
        // Both off: keep the local table on, because it is the only provider that can never be
        // broken by an external dependency.
        return (true, false, true);
    }

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
