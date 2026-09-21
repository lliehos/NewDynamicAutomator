using DynamicAutomator.Domain.Enums;

namespace DynamicAutomator.Domain.Entities;

public class AutomationTask
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public int DelayBeforeMs { get; set; }
    public int DelayAfterMs { get; set; }
    public int? CreatorUserId { get; set; }
    public DateTime? LastExecutedAtUtc { get; set; }
    public int? LastExecuteUserId { get; set; }
    public int? CopyFromId { get; set; }
    public bool UseGlobalDataSources { get; set; }

    /// <summary>Viewport and node coordinates for the visual flowchart editor.</summary>
    public string? CanvasJson { get; set; }

    /// <summary>Manual designer vs captured from the Chrome recorder.</summary>
    public TaskDesignOrigin DesignOrigin { get; set; } = TaskDesignOrigin.Manual;

    public AppUser? Creator { get; set; }
    public ICollection<Group> Groups { get; set; } = new List<Group>();
    public ICollection<UserTaskAccess> UserAccess { get; set; } = new List<UserTaskAccess>();
    public ICollection<DataSource> DataSources { get; set; } = new List<DataSource>();
}
