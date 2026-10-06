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
    /// <summary>
    /// Relative web path of the user's profile image (e.g. /uploads/avatars/u12.png).
    /// Null → the UI falls back to the user's initials, so an avatar is never required.
    /// </summary>
    public string? AvatarPath { get; set; }
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

    /// <summary>
    /// Set when the account's password no longer satisfies the policy its plan now states — an admin
    /// moved the user to a stricter plan without setting a new password. Nobody can tell whether the
    /// stored one would pass (only its hash is kept), so the user picks a new one: the next sign-in
    /// sends them to the change-password form, and this clears once they save a compliant password.
    /// </summary>
    public bool PasswordChangeRequired { get; set; }

    public Plan? Plan { get; set; }
    public ICollection<Process> CreatedProcesses { get; set; } = new List<Process>();
    public ICollection<ProcessShare> ProcessShares { get; set; } = new List<ProcessShare>();
}
