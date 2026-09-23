namespace Morobot.Domain.Entities;

/// <summary>Browser/device fingerprint seen for a user (anti-bypass audit).</summary>
public class DeviceSession
{
    public long Id { get; set; }
    public int UserId { get; set; }
    public string FingerprintHash { get; set; } = string.Empty;
    /// <summary>Cross-browser machine id used to block multiple Local/guest identities.</summary>
    public string? MachineFingerprint { get; set; }
    public string? ClaimedUserName { get; set; }
    public string? UserAgent { get; set; }
    public string? Platform { get; set; }
    public string? Language { get; set; }
    public string? TimeZone { get; set; }
    public string? Screen { get; set; }
    public int? HardwareConcurrency { get; set; }
    public string? IpAddress { get; set; }
    public string? DetailsJson { get; set; }
    public DateTime FirstSeenUtc { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenUtc { get; set; } = DateTime.UtcNow;
    public int LoginCount { get; set; } = 1;

    public AppUser User { get; set; } = null!;
}
