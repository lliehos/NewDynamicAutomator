namespace Morobot.Domain.Entities;

/// <summary>Latest imported signed license document. Replacing this row never deletes user/process data.</summary>
public class StoredLicense
{
    public int Id { get; set; }
    public string RawJson { get; set; } = string.Empty;
    public string LicenseId { get; set; } = string.Empty;
    public long Sequence { get; set; }
    public DateTime ValidUntilUtc { get; set; }
    public int? MaxUsers { get; set; }
    public string? OrganizationName { get; set; }
    public bool AllowUpdates { get; set; } = true;
    public int TrialDays { get; set; } = 3;
    public string? DatabaseServerHint { get; set; }
    public string? AllowedHost { get; set; }
    public DateTime ImportedAtUtc { get; set; }
}
