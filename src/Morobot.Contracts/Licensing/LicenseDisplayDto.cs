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
    /// <summary>
    /// Vendor-granted ability to manage user plan levels (default ON). When it is off — and in a
    /// trial — the deployment has no plan levels at all and every user sits at the top one.
    /// </summary>
    public bool AllowPlanManagement { get; set; }
    /// <summary>
    /// Whether both languages are offered (default ON). When it is off the install is locked to the
    /// system default language and the language switcher is hidden.
    /// </summary>
    public bool AllowBilingual { get; set; }
    /// <summary>
    /// Whether the front-end package (the public site) is active (default OFF). When it is off the
    /// deployment is panel-first: an unauthenticated visitor lands on the panel instead of the
    /// public front page. The page itself stays reachable at <c>/Home/Index</c>.
    /// </summary>
    public bool AllowFrontPackage { get; set; }
    /// <summary>
    /// Whether processes may run locally on a user's own machine (default OFF). Granted explicitly
    /// because local execution moves work off the server.
    /// </summary>
    public bool AllowLocalRun { get; set; }
    /// <summary>
    /// Whether this deployment may SELL — plans, the software package and licenses (default OFF).
    /// Off for a customer's own on-premise install; on for the deployment the vendor hosts.
    /// </summary>
    public bool AllowCommerce { get; set; }
    /// <summary>Whether the software package itself may be sold (default OFF; needs commerce on).</summary>
    public bool AllowSoftwarePurchase { get; set; }
    /// <summary>Whether the panel may issue its own licenses (default OFF; needs commerce on).</summary>
    public bool AllowSelfIssuedLicenses { get; set; }
    /// <summary>Signed public base URL of this deployment (null = none named).</summary>
    public string? ServerBaseUrl { get; set; }
    public bool ShowCopyright { get; set; }
    public string? DatabaseServerHint { get; set; }
    public string? UpdateServerUrl { get; set; }
    public string? PendingConnectionRestart { get; set; }
    public string? AllowedHost { get; set; }
    /// <summary>Signed link for the referral QR widget (null = use the built-in product page).</summary>
    public string? ReferralWidgetUrl { get; set; }
}

public sealed class TenantBrandingDto
{
    /// <summary>
    /// Legacy single-value name, kept because the licence file and older rows still carry it.
    /// </summary>
    /// <remarks>
    /// Not entered on Admin → Branding any more: the page has one box per language, and a separate
    /// unqualified box read as a third meaningless field beside them. It survives as the fallback
    /// for an install whose ONLY value is this one — an older deployment, or a licence that names
    /// the product — so nothing that used to show a name can start showing a blank.
    /// </remarks>
    public string AppName { get; set; } = "Morobot";

    /// <summary>Legacy single-value title. See <see cref="AppName"/>.</summary>
    public string BrandTitle { get; set; } = "Morobot";

    /// <summary>Legacy single-value organization. See <see cref="AppName"/>.</summary>
    public string? OrganizationName { get; set; }

    public string? LogoUrl { get; set; }
    public string? FaviconUrl { get; set; }
    public bool IsLicensedBranding { get; set; }

    /// <summary>
    /// The name and organization, one value per language.
    /// </summary>
    /// <remarks>
    /// The product is bilingual and was originally single-valued, so a Persian deployment and an
    /// English one showed the same text. Each is now entered per language. A blank language falls
    /// back to the OTHER language before the legacy single value, so filling one side still leaves
    /// a usable site in both — and does not leave one language blank.
    /// </remarks>
    public string? AppNameEn { get; set; }
    public string? AppNameFa { get; set; }
    public string? OrganizationNameEn { get; set; }
    public string? OrganizationNameFa { get; set; }

    public string ColorPrimary { get; set; } = BrandPaletteDefaults.Primary;
    public string ColorPrimaryDark { get; set; } = BrandPaletteDefaults.PrimaryDark;
    public string ColorPrimaryLight { get; set; } = BrandPaletteDefaults.PrimaryLight;
    public string ColorAccent { get; set; } = BrandPaletteDefaults.Accent;
    public string ColorSoft { get; set; } = BrandPaletteDefaults.Soft;
    public string ColorSoft2 { get; set; } = BrandPaletteDefaults.Soft2;
    public string ColorInk { get; set; } = BrandPaletteDefaults.Ink;
    public string ColorBorderSubtle { get; set; } = BrandPaletteDefaults.BorderSubtle;

    /// <summary>
    /// Diagram colours — the palette the flow editor draws with, and the outline the player draws
    /// around a page element while running.
    /// </summary>
    /// <remarks>
    /// These live on the branding page rather than the settings page: they are colours, and every
    /// other colour the tenant can change is already here. The colour list itself is
    /// <c>SystemSettingKeys.DiagramColors</c> — that is the single source of truth for which
    /// colours exist, what they ship as, and what "reset to default" restores. This dictionary is
    /// keyed by setting key so adding a colour there is enough to have it show up, save and reset.
    /// </remarks>
    public Dictionary<string, string> DiagramColors { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Diagram behaviour defaults — the values a new process's canvas starts from, and the two
    /// ignore-error switches the editor shows.
    /// </summary>
    /// <remarks>
    /// Same reasoning as <see cref="DiagramColors"/>: they describe how the diagram behaves, so they
    /// belong on the page that already owns the diagram's appearance. Keyed by setting key so the
    /// form posts, and the page renders, the same names the settings table uses.
    /// </remarks>
    public Dictionary<string, string> DiagramDefaults { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Panel referral QR widget (morobot.ir). Enterprise can disable when licensed.</summary>
    public bool ShowReferralQrWidget { get; set; } = true;

    /// <summary>
    /// Whether the public front site should be the default landing page. Read-only here: the raw
    /// setting is written by the Branding controller, which is also the only place that knows
    /// whether the licence carries the front-end package. Defaults to off, matching the seeded row,
    /// so a deployment that has just been granted the package does not publish a site nobody
    /// configured.
    /// </summary>
    public string FrontShowSite { get; set; } = "false";

    /// <summary>
    /// Vendor-signed link for the referral widget, taken from the licence file. Null when the
    /// licence names none, in which case the product page compiled into the app is used.
    /// </summary>
    public string? ReferralWidgetUrl { get; set; }
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
