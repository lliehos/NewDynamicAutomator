using Morobot.Domain.Enums;

namespace Morobot.Domain.Entities;

/// <summary>Automation process; source of truth for the graph is <see cref="GraphJson"/>.</summary>
public class Process
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public int? LastEditorUserId { get; set; }
    public Guid? DeploymentInstanceId { get; set; }
    public int DelayBeforeMs { get; set; }
    public int DelayAfterMs { get; set; }
    public int? CreatorUserId { get; set; }
    public DateTime? LastExecutedAtUtc { get; set; }
    public int? LastExecuteUserId { get; set; }

    /// <summary>Full editor/player graph (nodes, edges, viewport). Linked sources hydrate into dataSources at load.</summary>
    public string? GraphJson { get; set; }

    public TaskDesignOrigin DesignOrigin { get; set; } = TaskDesignOrigin.Manual;

    /// <summary>
    /// The template this process is built on, or null when it stands alone. Non-null means the
    /// process inherits the template's graph whenever the template is published, and that its own
    /// graph is not editable in place — the editor sends the change to the template instead. Source
    /// links are the exception: they always belong to the process and are never inherited.
    /// </summary>
    public int? TemplateId { get; set; }

    /// <summary>
    /// The template <see cref="ProcessTemplate.Version"/> this process last inherited. Compared
    /// against the template's current version to tell "is behind the template" from "is current"
    /// without parsing either graph, so the process list can flag a stale process cheaply.
    /// </summary>
    public int? TemplateVersion { get; set; }

    public ProcessTemplate? Template { get; set; }

    public AppUser? Creator { get; set; }
    public AppUser? LastEditor { get; set; }
    public ICollection<ProcessShare> Shares { get; set; } = new List<ProcessShare>();
    public ICollection<ProcessDataSource> DataSourceLinks { get; set; } = new List<ProcessDataSource>();
}
