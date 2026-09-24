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
    /// <summary>Optional override for update check URL.</summary>
    public string? UpdateServerUrl { get; set; }
}
