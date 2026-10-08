namespace Webautomator.Infrastructure.Options;

public sealed class WebautomatorOptions
{
    public const string SectionName = "Webautomator";

    /// <summary>
    /// The per-user folder this product keeps its data under (%LocalAppData%\{BrandFolderName}).
    /// A neutral, product-agnostic name: the old domain-shaped folder conflated "where the brand's
    /// website lives" with "where this deployment stores files", and read like a URL, not a path.
    /// </summary>
    public const string BrandFolderName = "webautomator";

    /// <summary>Pre-rename folder name. MIGRATIONS ONLY — nothing may write to it any more.</summary>
    public const string PreviousBrandFolderName = "webautomator.soras.ir";

    /// <summary>Legacy/hosting label (Cloud | Enterprise). Does not disable licensing.</summary>
    public string DeploymentMode { get; set; } = nameof(Domain.Enums.DeploymentMode.Cloud);

    /// <summary>Licensing is always enforced (trial → licensed → restricted).</summary>
    public bool IsLicensingEnabled => true;

    /// <summary>
    /// Unique id for this deployment (e.g. cloud-prod-a, acme-onprem).
    ///
    /// Only needed when more than one deployment shares one machine — the product is deployed once
    /// per server, and the deployment's identity for the extension pairing is the server host
    /// fingerprint (the same value the licence shows). Leave it unset for the normal case: the
    /// extension folder is then simply `webautomator\extension-global`, with no extra key level.
    /// </summary>
    public string AppInstanceKey { get; set; } = "default";

    /// <summary>Informational copy of the deployment's public base URL, when configured.</summary>
    public string? PublicBaseUrl { get; set; }

    public string? LicensePublicKeyPem { get; set; }

    /// <summary>
    /// PRIVATE key used to sign licenses this deployment issues after a sale (see
    /// <c>LicenseService.BuildOrderLicenseJsonAsync</c>).
    /// </summary>
    /// <remarks>
    /// Only the STOREFRONT operator sets this — the vendor, or a reseller the vendor authorised. A
    /// normal install verifies licenses with <see cref="LicensePublicKeyPem"/> and must never hold
    /// the private half, because holding it would let that install mint licenses for itself with no
    /// vendor in the loop. The separate <c>AllowSelfIssuedLicenses</c> licence flag gates whether this
    /// key may be used at all, so possession alone is not enough.
    /// </remarks>
    public string? OrderIssuingKeyPem { get; set; }

    public UpdateFeedOptions UpdateFeed { get; set; } = new();

    public string EffectiveAppInstanceKey => DeriveAppInstanceKey(AppInstanceKey);

    /// <summary>
    /// The optional key this deployment uses to separate its extension folder from another
    /// deployment's on the SAME machine. `default` means "no key": the folder is not nested.
    /// </summary>
    public static string DeriveAppInstanceKey(string? configured)
        => SanitizeAppInstanceKey(configured);

    /// <summary>True when no explicit key is set — the normal, one-deployment-per-server case.</summary>
    public static bool IsDefaultAppInstanceKey(string? raw)
        => SanitizeAppInstanceKey(raw).Equals("default", StringComparison.OrdinalIgnoreCase);

    public static string SanitizeAppInstanceKey(string? raw)
    {
        var key = string.IsNullOrWhiteSpace(raw) ? "default" : raw.Trim();
        key = System.Text.RegularExpressions.Regex.Replace(key, @"[^\w\-\.]", "-");
        if (key.Length > 64) key = key[..64];
        return string.IsNullOrEmpty(key) ? "default" : key;
    }

    public Domain.Enums.DeploymentMode ParsedMode =>
        Enum.TryParse<Domain.Enums.DeploymentMode>(DeploymentMode, true, out var mode)
            ? mode
            : Domain.Enums.DeploymentMode.Cloud;

    public bool IsEnterprise => ParsedMode == Domain.Enums.DeploymentMode.Enterprise;
}
