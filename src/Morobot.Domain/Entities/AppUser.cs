using Morobot.Domain.Enums;

namespace Morobot.Domain.Entities;

public class AppUser
{
    public int Id { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    /// <summary>National ID / کد ملی (optional; used for share search).</summary>
    public string? NationalId { get; set; }
    /// <summary>UI culture: fa | en. Default Persian.</summary>
    public string PreferredLanguage { get; set; } = "fa";
    public string? AppVersion { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    /// <summary>When set, must match current deployment instance unless a valid license is active.</summary>
    public Guid? DeploymentInstanceId { get; set; }

    public UserRole Role { get; set; } = UserRole.User;
    public int? PlanId { get; set; }
    public DateTime? PlanExpiresAtUtc { get; set; }

    public Plan? Plan { get; set; }
    public ICollection<Process> CreatedProcesses { get; set; } = new List<Process>();
    public ICollection<ProcessShare> ProcessShares { get; set; } = new List<ProcessShare>();
}
