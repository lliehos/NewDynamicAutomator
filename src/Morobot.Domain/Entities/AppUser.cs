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
    /// <summary>UI culture: fa | en. Default Persian.</summary>
    public string PreferredLanguage { get; set; } = "fa";
    public string? AppVersion { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public ICollection<AutomationTask> CreatedTasks { get; set; } = new List<AutomationTask>();
    public ICollection<UserTaskAccess> TaskAccess { get; set; } = new List<UserTaskAccess>();
}
