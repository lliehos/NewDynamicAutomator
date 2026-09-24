namespace Morobot.Infrastructure.Options;

public sealed class MorobotOptions
{
    public const string SectionName = "Morobot";

    /// <summary>Cloud | Enterprise</summary>
    public string DeploymentMode { get; set; } = nameof(Domain.Enums.DeploymentMode.Cloud);

    /// <summary>
    /// Unique id for this Morobot deployment (e.g. cloud-prod-a, acme-onprem).
    /// Used to isolate extension sync folders on a machine running multiple instances.
    /// </summary>
    public string AppInstanceKey { get; set; } = "default";

    public string? LicensePublicKeyPem { get; set; }

    public string EffectiveAppInstanceKey => SanitizeAppInstanceKey(AppInstanceKey);

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
