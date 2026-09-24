namespace Morobot.Licensing;

public sealed class ActivationRequest
{
    public const int CurrentVersion = 1;

    public string Format { get; set; } = LicenseFormats.ActivationRequest;
    public int Version { get; set; } = CurrentVersion;
    public string DeploymentAnchorId { get; set; } = string.Empty;
    public string? OrganizationHint { get; set; }
    public string? MachineName { get; set; }
    /// <summary>SHA-256 hex of server host identity (trial binding).</summary>
    public string? ServerFingerprintHash { get; set; }
    public string? AppVersion { get; set; }
    public DateTime RequestedAtUtc { get; set; }
}
