namespace Morobot.Domain.Entities;

/// <summary>Stable install identity for enterprise licensing. Created once per deployment.</summary>
public class DeploymentAnchor
{
    public int Id { get; set; }
    public Guid AnchorId { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public long MonotonicCounter { get; set; }
    public DateTime LastTrustedUtc { get; set; }
    /// <summary>SHA-256 hex of host hardware/OS identity at install time.</summary>
    public string ServerFingerprintHash { get; set; } = string.Empty;
}
