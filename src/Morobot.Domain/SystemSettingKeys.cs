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
        LdapUseTls,
        PasswordRequireLetterAndDigit,
        DiagramIgnorePlayError,
        DiagramNodeIgnoreError
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
        DefaultRegisterPlan,
        // The password floor reads after the sign-in providers: it governs how a password is
        // accepted, so it belongs with the credentials rather than above the switches that decide
        // whether credentials are used at all.
        PasswordMinLength,
        PasswordRequireLetterAndDigit
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

    // ── Password policy ──
    // The policy used to live only on each Plan (MinPasswordLength / RequireLetterAndDigit), which
    // meant an install with no plan levels had no password rules at all — the very installs that
    // most need a floor, since a licensed-with-plans deployment states its policy per plan. These
    // two settings are that floor.
    //
    // They are read as a FALLBACK: a plan that states its own rules still wins (see
    // PasswordPolicy.Resolve), so a deployment selling a strong-password tier is unaffected. These
    // values are what applies when there is no plan to ask.

    /// <summary>Minimum password length used when no plan states one.</summary>
    public const string PasswordMinLength = "PasswordMinLength";
    /// <summary>"true" when a password must contain a letter and a digit and no plan states a rule.</summary>
    public const string PasswordRequireLetterAndDigit = "PasswordRequireLetterAndDigit";

    /// <summary>
    /// The global password-policy settings, in the order the Auth card renders them: the length,
    /// then the complexity switch that qualifies it.
    /// </summary>
    /// <remarks>
    /// Declared here rather than only in the view so that a caller wanting "the password settings"
    /// has one list to read, and so adding a third rule has an obvious home.
    /// </remarks>
    public static readonly IReadOnlyList<string> PasswordPolicyKeys = new[]
    {
        PasswordMinLength,
        PasswordRequireLetterAndDigit
    };

    /// <summary>True when the key is one of the global password-policy settings.</summary>
    public static bool IsPasswordPolicy(string? key) =>
        !string.IsNullOrWhiteSpace(key)
        && PasswordPolicyKeys.Contains(key, StringComparer.OrdinalIgnoreCase);

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

    // ── Node state colours ──
    // These were hard-coded inside the editor, so an administrator could restyle action and
    // condition nodes but not a start node, and could not distinguish an "ignored" action at all.
    /// <summary>Fill of the root start node while it ignores play errors (the healthy default).</summary>
    public const string DiagramStartFill = "DiagramStartFill";
    /// <summary>Stroke of the root start node while it ignores play errors.</summary>
    public const string DiagramStartStroke = "DiagramStartStroke";
    /// <summary>Fill of the root start node when it stops the run on an error.</summary>
    public const string DiagramStartWarnFill = "DiagramStartWarnFill";
    /// <summary>Stroke of the root start node when it stops the run on an error.</summary>
    public const string DiagramStartWarnStroke = "DiagramStartWarnStroke";
    /// <summary>Stroke of an action node whose own error is ignored.</summary>
    public const string DiagramStepIgnoreStroke = "DiagramStepIgnoreStroke";
    /// <summary>Fill of an action node whose own error is ignored.</summary>
    public const string DiagramStepIgnoreFill = "DiagramStepIgnoreFill";

    // ── Edge colours ──
    /// <summary>Colour of an ordinary "next" connection.</summary>
    public const string DiagramEdgeNextColor = "DiagramEdgeNextColor";
    /// <summary>Colour of a condition's success branch.</summary>
    public const string DiagramEdgeSuccessColor = "DiagramEdgeSuccessColor";
    /// <summary>Colour of a condition's failure branch.</summary>
    public const string DiagramEdgeFailColor = "DiagramEdgeFailColor";
    /// <summary>Colour of a group's containment connection.</summary>
    public const string DiagramEdgeParentColor = "DiagramEdgeParentColor";

    // ── Canvas / chrome ──
    /// <summary>Faint line drawn for an unwired port.</summary>
    public const string DiagramCanvasEdgeColor = "DiagramCanvasEdgeColor";
    /// <summary>Colour of a node's title text.</summary>
    public const string DiagramLabelColor = "DiagramLabelColor";
    /// <summary>Colour of secondary text inside a node.</summary>
    public const string DiagramMutedLabelColor = "DiagramMutedLabelColor";
    /// <summary>Stroke width of the selector outline drawn while playing.</summary>
    public const string DiagramSelectorLineWidth = "DiagramSelectorLineWidth";
    /// <summary>Default pause between two steps, in milliseconds.</summary>
    public const string DiagramStepDelayMs = "DiagramStepDelayMs";
    /// <summary>Default maximum times a node may be revisited before a loop is declared stuck.</summary>
    public const string DiagramLoopBackLimit = "DiagramLoopBackLimit";

    /// <summary>
    /// Default for the ROOT START node's "continue the run even if an action fails".
    /// </summary>
    /// <remarks>
    /// The start node is the process-level switch: the engine's <c>resolveIgnorePlayError</c> reads
    /// it first, and it decides whether a failed step aborts the whole run or just moves to the next
    /// loop index. The editor's own default has always been ON (see <c>resolveIgnorePlayError</c> and
    /// the start-node inspector), so this setting only changes the starting point for a NEW process.
    /// </remarks>
    public const string DiagramIgnorePlayError = "DiagramIgnorePlayError";

    /// <summary>
    /// Default for a new INNER node's "ignore this step's error".
    /// </summary>
    /// <remarks>
    /// Distinct from <see cref="DiagramIgnorePlayError"/> on purpose. They are two different
    /// switches that happen to share a name in the UI:
    /// <list type="bullet">
    /// <item>the START node's flag is the process-level policy — did the run survive a failure;</item>
    /// <item>an inner node's <c>ignoreError</c> is per-step — was THIS step allowed to fail.</item>
    /// </list>
    /// One admin setting could not express both: an install that wants "keep going but tell me which
    /// step broke" needs the start flag on and the inner default off.
    /// </remarks>
    public const string DiagramNodeIgnoreError = "DiagramNodeIgnoreError";

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

    /// <summary>
    /// Keys owned by the Diagram group, in the order the editor reads them.
    /// </summary>
    /// <remarks>
    /// The per-colour "apply" switches that used to sit beside these are gone. They existed so an
    /// admin could compare a colour against the built-in default without retyping it, but that made
    /// every colour mean two settings and left the editor guessing which one won. A reset-to-default
    /// action does the same job in one click with one source of truth, so the switches were replaced
    /// by <see cref="DiagramColors"/> (with the shipped value on each entry) plus the reset endpoint.
    /// </remarks>
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
    /// Every colour the diagram draws with, together with the value the product ships.
    /// </summary>
    /// <remarks>
    /// The list is the single source of truth for three things: which colour fields the admin page
    /// renders, what "reset to default" restores, and what the editor falls back to when a value is
    /// missing. Keeping the shipped default here rather than inline in the editor is what makes the
    /// reset button honest — it restores exactly the value an untouched install would use.
    ///
    /// The six "node" colours were settings before; the rest were hard-coded inside flow.js, so an
    /// administrator could change the node palette but not a start node or an edge. They are all
    /// settings now.
    /// </remarks>
    public static readonly IReadOnlyList<DiagramColorInfo> DiagramColors = new[]
    {
        // ── Node colours ──
        new DiagramColorInfo(DiagramStepStroke, "#ff9f43", "stepStroke", "Diagram", "رنگ خط اقدام", "Action stroke"),
        new DiagramColorInfo(DiagramStepFill, "#fff8f0", "stepFill", "Diagram", "رنگ پس‌زمینه اقدام", "Action fill"),
        new DiagramColorInfo(DiagramConditionStroke, "#8b9098", "conditionStroke", "Diagram", "رنگ خط شرط", "Condition stroke"),
        new DiagramColorInfo(DiagramConditionFill, "#eceff2", "conditionFill", "Diagram", "رنگ پس‌زمینه شرط", "Condition fill"),
        new DiagramColorInfo(DiagramGroupStroke, "#9b92f8", "groupStroke", "Diagram", "رنگ خط گروه", "Group stroke"),
        new DiagramColorInfo(DiagramHighlightColor, "#ea5455", "highlightColor", "Diagram", "رنگ هایلایت المان", "Element highlight"),
        // ── Node state colours (were hard-coded in flow.js) ──
        new DiagramColorInfo(DiagramStartFill, "#159a55", "startFill", "Diagram", "رنگ نود شروع", "Start node fill"),
        new DiagramColorInfo(DiagramStartStroke, "#0d7a40", "startStroke", "Diagram", "رنگ خط نود شروع", "Start node stroke"),
        new DiagramColorInfo(DiagramStartWarnFill, "#e8943a", "startWarnFill", "Diagram", "رنگ نود شروع (خطا)", "Start node fill (errors on)"),
        new DiagramColorInfo(DiagramStartWarnStroke, "#c66f18", "startWarnStroke", "Diagram", "رنگ خط نود شروع (خطا)", "Start node stroke (errors on)"),
        new DiagramColorInfo(DiagramStepIgnoreStroke, "#28c76f", "stepIgnoreStroke", "Diagram", "رنگ خط اقدام چشم‌پوشی‌شده", "Ignored action stroke"),
        new DiagramColorInfo(DiagramStepIgnoreFill, "#e8f6ee", "stepIgnoreFill", "Diagram", "رنگ پس‌زمینه اقدام چشم‌پوشی‌شده", "Ignored action fill"),
        // ── Edge colours ──
        new DiagramColorInfo(DiagramEdgeNextColor, "#7367f0", "edgeNext", "Diagram", "رنگ اتصال عادی", "Normal edge"),
        new DiagramColorInfo(DiagramEdgeSuccessColor, "#28c76f", "edgeSuccess", "Diagram", "رنگ اتصال موفقیت", "Success edge"),
        new DiagramColorInfo(DiagramEdgeFailColor, "#ea5455", "edgeFail", "Diagram", "رنگ اتصال شکست", "Failure edge"),
        new DiagramColorInfo(DiagramEdgeParentColor, "#00cfe8", "edgeParent", "Diagram", "رنگ اتصال گروه", "Group edge"),
        // ── Canvas / chrome ──
        new DiagramColorInfo(DiagramCanvasEdgeColor, "#e4e1f5", "canvasEdge", "Diagram", "رنگ لبهٔ خالی", "Empty port edge"),
        new DiagramColorInfo(DiagramLabelColor, "#4b465c", "labelColor", "Diagram", "رنگ متن نود", "Node label text"),
        new DiagramColorInfo(DiagramMutedLabelColor, "#9a96a8", "mutedLabel", "Diagram", "رنگ متن کم‌رنگ", "Muted label text"),
    };

    /// <summary>Where a key sits in <see cref="DiagramColors"/>, or -1 when it is not a diagram colour.</summary>
    public static int DiagramColorIndex(string? key) =>
        key is null ? -1
        : DiagramColors.ToList().FindIndex(c => string.Equals(c.Key, key, StringComparison.OrdinalIgnoreCase));

    /// <summary>True when the key is one of the diagram colours.</summary>
    public static bool IsDiagramColor(string? key) => DiagramColorIndex(key) >= 0;

    /// <summary>The shipped default for a diagram colour, or null when the key is not one.</summary>
    public static string? DiagramColorDefault(string? key)
    {
        var i = DiagramColorIndex(key);
        return i < 0 ? null : DiagramColors[i].DefaultValue;
    }

    /// <summary>One diagram colour: its setting key, shipped default, editor field name and labels.</summary>
    public sealed record DiagramColorInfo(
        string Key, string DefaultValue, string EditorField, string Group, string LabelFa, string LabelEn);

    /// <summary>
    /// Colour keys that used to control whether a colour was applied. Retired — the reset-to-default
    /// action replaces them — but named here so the settings page can filter out and delete any rows
    /// an older install still has.
    /// </summary>
    public static readonly IReadOnlyList<string> RetiredDiagramColorSwitches = new[]
    {
        DiagramStepStrokeEnabled,
        DiagramStepFillEnabled,
        DiagramConditionStrokeEnabled,
        DiagramConditionFillEnabled,
        DiagramGroupStrokeEnabled,
        DiagramHighlightColorEnabled
    };

    /// <summary>True when a key is one of the retired per-colour apply switches.</summary>
    public static bool IsRetiredDiagramSwitch(string? key) =>
        !string.IsNullOrWhiteSpace(key)
        && RetiredDiagramColorSwitches.Contains(key, StringComparer.OrdinalIgnoreCase);
    /// <summary>
    /// The two "ignore error" defaults, which the settings page shows in their own card.
    /// </summary>
    /// <remarks>
    /// They are separated from the rest of the Diagram group because they answer a different
    /// question: the others are numbers a new process starts from, while these two are the starting
    /// state of two different switches in the editor that happen to share a label. Grouping them
    /// makes that distinction visible instead of hiding it in a list of unrelated settings.
    /// </remarks>
    public static readonly IReadOnlyList<string> IgnoreErrorDefaults = new[]
    {
        DiagramIgnorePlayError,
        DiagramNodeIgnoreError
    };

    /// <summary>True when the key is one of the two ignore-error defaults.</summary>
    public static bool IsIgnoreErrorDefault(string? key) =>
        !string.IsNullOrWhiteSpace(key)
        && IgnoreErrorDefaults.Contains(key, StringComparer.OrdinalIgnoreCase);
    /// <summary>
    /// Every diagram colour, plus the retired switches, as one set. Used to keep these off
    /// Admin → Settings, where they would otherwise duplicate Admin → Branding.
    /// </summary>
    public static readonly IReadOnlySet<string> DiagramColorOwnedKeys =
        new HashSet<string>(
            DiagramColors.Select(c => c.Key).Concat(RetiredDiagramColorSwitches),
            StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Settings holding a hex colour. Admin → Branding renders these with a colour picker; the
    /// set is declared here rather than sniffed from the value so a colour that happens to be
    /// empty still gets the right control.
    /// </summary>
    public static readonly IReadOnlySet<string> ColourKeys = new HashSet<string>(
        DiagramColors.Select(c => c.Key).Concat(new[]
        {
            BrandColorPrimary,
            BrandColorPrimaryDark,
            BrandColorPrimaryLight,
            BrandColorAccent,
            BrandColorSoft,
            BrandColorSoft2,
            BrandColorInk,
            BrandColorBorderSubtle,
        }),
        StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The diagram behaviour defaults that moved to Admin → Branding along with the colours.
    /// </summary>
    /// <remarks>
    /// These are the values a NEW process's canvas starts from — selector line width, step delay,
    /// loop-back limit and the two ignore-error defaults. They used to sit in the Diagram group on
    /// Admin → Settings, which split the diagram's appearance across two pages: an admin changing
    /// the palette on Branding and the node behaviour on Settings had to know the two were related.
    /// Listing them here is what removes them from Settings — a key is rendered by the page that
    /// owns it (see <see cref="IsBrandingOwned"/>).
    /// </remarks>
    public static readonly IReadOnlySet<string> DiagramBehaviourOwned = new HashSet<string>(
        new[]
        {
            DiagramSelectorLineWidth,
            DiagramStepDelayMs,
            DiagramLoopBackLimit,
            DiagramIgnorePlayError,
            DiagramNodeIgnoreError
        },
        StringComparer.OrdinalIgnoreCase);

    /// <summary>True when the key is one of the diagram behaviour defaults now owned by Branding.</summary>
    public static bool IsDiagramBehaviourOwned(string? key) =>
        !string.IsNullOrWhiteSpace(key) && DiagramBehaviourOwned.Contains(key);

    /// <summary>
    /// Keys owned by Admin → Branding. Admin → Settings must NOT list these: both pages read and
    /// write the same rows, so exposing them in two places let a stale Settings form silently
    /// overwrite branding (or vice versa). Branding values are also licence-gated and need the
    /// dedicated editor with its colour pickers and image uploads.
    /// </summary>
    /// <remarks>
    /// The diagram colours and their apply switches are included: they are colours, so they belong
    /// with the rest of the palette on the branding page rather than scattered through the Diagram
    /// group on Settings. Listing them here is what removes them from Settings — a key can only be
    /// rendered by the page that owns it.
    /// </remarks>
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
        BrandReferralQrVisible,
        // Spelled out rather than referencing DiagramBehaviourOwned: static field initialisers run in
        // declaration order, so that field (declared below) would still be null here.
        DiagramSelectorLineWidth,
        DiagramStepDelayMs,
        DiagramLoopBackLimit,
        DiagramIgnorePlayError,
        DiagramNodeIgnoreError
    }.Concat(DiagramColorOwnedKeys).ToHashSet(StringComparer.OrdinalIgnoreCase);

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
        // "Diagram" is gone from this page. Its colours moved to Admin → Branding first, and now the
        // behaviour defaults (selector width, step delay, loop-back limit, the two ignore-error
        // switches) have followed them, so nothing diagram-related is left. The group is declared on
        // the Branding side instead — see the views that render it there.
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
