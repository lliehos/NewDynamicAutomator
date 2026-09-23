using Morobot.Domain.Enums;

namespace Morobot.Domain.Entities;

/// <summary>Automation process; source of truth for the graph is <see cref="GraphJson"/>.</summary>
public class Process
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public int DelayBeforeMs { get; set; }
    public int DelayAfterMs { get; set; }
    public int? CreatorUserId { get; set; }
    public DateTime? LastExecutedAtUtc { get; set; }
    public int? LastExecuteUserId { get; set; }

    /// <summary>Full editor/player graph (nodes, edges, viewport). Linked sources hydrate into dataSources at load.</summary>
    public string? GraphJson { get; set; }

    public TaskDesignOrigin DesignOrigin { get; set; } = TaskDesignOrigin.Manual;

    public AppUser? Creator { get; set; }
    public ICollection<ProcessShare> Shares { get; set; } = new List<ProcessShare>();
    public ICollection<ProcessDataSource> DataSourceLinks { get; set; } = new List<ProcessDataSource>();
}
