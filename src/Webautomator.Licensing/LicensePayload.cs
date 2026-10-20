namespace Webautomator.Licensing;

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
    public int TrialDays { get; set; } = 10;
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
    /// The public base URL of the server this licence was issued for, e.g. https://panel.example.com.
    /// </summary>
    /// <remarks>
    /// Signed into the licence so a client never has to be told it. The desktop player reads this to
    /// know which server to call — asking the user to type an address was both a needless step and a
    /// wrong one, since the address is already fixed by the licence that authorises the install, and
    /// typing it by hand could only ever point the app at a different deployment than the one it is
    /// licensed for. Empty falls back to the host lock, or to a same-machine address in development.
    /// </remarks>
    public string? ServerBaseUrl { get; set; }
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

    /// <summary>
    /// Whether this deployment may run processes locally on a user's own machine.
    /// </summary>
    /// <remarks>
    /// Covers the whole local-execution feature: the desktop runner, the per-process "run on server"
    /// switch, and the client-side offline cell store. Deliberately <c>false</c> by default — OPT-IN,
    /// like <see cref="AllowFrontPackage"/> and unlike <see cref="AllowPlanManagement"/>. Local
    /// execution moves work off the server, so it is a capability a vendor grants rather than one a
    /// deployment should acquire by omission; and a licence signed before this flag existed must keep
    /// behaving exactly as it did. A vendor who sells it passes <c>--allow-local-run true</c>.
    /// </remarks>
    public bool AllowLocalRun { get; set; }

    /// <summary>
    /// Whether this deployment may SELL — plans, the software package and licenses.
    /// </summary>
    /// <remarks>
    /// Gates every commerce surface: the public plan page, checkout, the purchase wizard, the
    /// renewal flow and the financial history. Deliberately <c>false</c> by default and opt-in, like
    /// <see cref="AllowFrontPackage"/>: an installation that is merely using the software must not
    /// start taking money because a flag defaulted the wrong way, and a licence signed before
    /// commerce existed has to keep behaving exactly as it did.
    ///
    /// This is what the vendor signs for the deployment they host on the internet — the one that
    /// earns from selling plans, packages and licenses. A customer's own on-premise install leaves
    /// it off.
    /// </remarks>
    public bool AllowCommerce { get; set; }

    /// <summary>
    /// Whether this deployment may sell the software package itself (the purchase wizard), as
    /// opposed to only selling plans.
    /// </summary>
    /// <remarks>
    /// A separate flag because the two are separately sellable: a reseller may be licensed to sell
    /// plan subscriptions without being allowed to hand out the software outright. Gated
    /// independently so turning on plan selling cannot silently enable package selling.
    /// </remarks>
    public bool AllowSoftwarePurchase { get; set; }

    /// <summary>
    /// Whether this deployment may issue new licenses to itself through the panel (the renewal
    /// wizard), rather than the vendor signing each one by hand.
    /// </summary>
    /// <remarks>
    /// The most powerful of the three and therefore the most narrowly granted: it lets a deployment
    /// mint its own licenses after payment, with no vendor in the loop. A vendor selling through
    /// this deployment's storefront grants it; anyone else must not have it.
    /// </remarks>
    public bool AllowSelfIssuedLicenses { get; set; }
}
