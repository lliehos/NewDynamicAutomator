namespace Morobot.Licensing;

/// <summary>Signed license content. Updates replace the stored document only — never user/process data.</summary>
public sealed class LicensePayload
{
    public const int CurrentVersion = 2;

    public int Version { get; set; } = CurrentVersion;
    public string LicenseId { get; set; } = string.Empty;
    public string? OrganizationName { get; set; }
    public string DeploymentAnchorId { get; set; } = string.Empty;
    public DateTime IssuedAtUtc { get; set; }
    public DateTime ValidUntilUtc { get; set; }
    /// <summary>Monotonic license revision — must not decrease on import.</summary>
    public long Sequence { get; set; } = 1;
    /// <summary>Total active users allowed. Null = unlimited.</summary>
    public int? MaxUsers { get; set; }
    /// <summary>SQL Server connection string for this deployment (vendor-signed).</summary>
    public string? DatabaseConnectionString { get; set; }
    /// <summary>Initial trial days when no license yet. Default 3.</summary>
    public int TrialDays { get; set; } = 3;
    /// <summary>Whether admin may check/apply online updates.</summary>
    public bool AllowUpdates { get; set; } = true;
    /// <summary>
    /// Whether "migrate from the legacy database" is available. Deliberately
    /// defaults to <c>false</c>: importing an old database is a deliberate,
    /// vendor-authorised operation, so a buyer must be granted it explicitly.
    /// </summary>
    public bool AllowLegacyMigration { get; set; }

    /// <summary>
    /// Whether the deployment may manage its own user plan levels.
    /// </summary>
    /// <remarks>
    /// Defaults to <c>true</c> rather than false, which is the opposite of
    /// <see cref="AllowLegacyMigration"/> on purpose: this flag was introduced after licences had
    /// already been signed, and JSON deserialisation leaves an absent bool at its default. A
    /// <c>false</c> default would have silently stripped plan management from every existing
    /// customer the moment they updated, and — because a licence without plan management puts all
    /// users at the top level — it would have looked like a free upgrade rather than a
    /// misconfiguration. A vendor who wants a flat install turns it off explicitly.
    /// </remarks>
    public bool AllowPlanManagement { get; set; } = true;

    /// <summary>
    /// Whether the deployment may offer both languages (Persian and English).
    /// </summary>
    /// <remarks>
    /// Defaults to <c>true</c> for the same reason as <see cref="AllowPlanManagement"/>: the flag
    /// arrived after licences had been signed, and an absent JSON value takes the CLR default. A
    /// <c>false</c> default would have switched every existing installation to a single language on
    /// update, and — because a single-language install hides the language switcher — the loss would
    /// have looked like a UI regression rather than a licence change.
    /// </remarks>
    public bool AllowBilingual { get; set; } = true;

    /// <summary>
    /// Whether this deployment's front-end package (the public site) is active. Drives which page
    /// an unauthenticated visitor lands on: with the package the public front page is the default,
    /// without it the panel is.
    /// </summary>
    /// <remarks>
    /// Deliberately <c>false</c> by default — OPT-IN, unlike <see cref="AllowPlanManagement"/>.
    /// The front-end package is a separate commercial bundle: a customer who never bought it must
    /// not acquire it by omission, and a licence signed before this flag existed has to keep
    /// behaving exactly as it did (panel-first). A vendor who sells the package passes
    /// <c>--allow-front-package true</c>.
    /// </remarks>
    public bool AllowFrontPackage { get; set; }

    /// <summary>Optional override for update check URL.</summary>
    public string? UpdateServerUrl { get; set; }
    /// <summary>When set, HTTP Host (or this IP) must match. Empty = no host lock.</summary>
    public string? AllowedHost { get; set; }
    /// <summary>
    /// Link the in-panel referral QR widget points at. Vendor-signed rather than a database
    /// setting so a deployment cannot repoint the traffic the widget sends out. Empty falls
    /// back to the product page compiled into the app.
    /// </summary>
    public string? ReferralWidgetUrl { get; set; }

    /// <summary>
    /// Hard ceiling on rows in any single data source, enforced regardless of plan. Null = no
    /// ceiling. A signed license is the only thing that can raise this, so a deployment cannot
    /// grant itself more rows than the vendor sold.
    /// </summary>
    public int? MaxSourceRows { get; set; }

    /// <summary>Hard ceiling in bytes on any single data source's content. Null = no ceiling.</summary>
    public long? MaxSourceBytes { get; set; }
}
