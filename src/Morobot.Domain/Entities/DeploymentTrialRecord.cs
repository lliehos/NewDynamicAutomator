namespace Morobot.Domain.Entities;

/// <summary>
/// One trial entitlement per physical/virtual host fingerprint. Survives anchor row deletion.</summary>
public class DeploymentTrialRecord
{
    public int Id { get; set; }
    public string ServerFingerprintHash { get; set; } = string.Empty;
    public DateTime TrialStartedUtc { get; set; }
    public int TrialDays { get; set; } = 3;
    public DateTime CreatedAtUtc { get; set; }
    public Guid? LinkedAnchorId { get; set; }
    /// <summary>Stable tenant epoch for this trial entitlement; new row = orphaned prior user/process data.</summary>
    public Guid InstanceId { get; set; }
}
