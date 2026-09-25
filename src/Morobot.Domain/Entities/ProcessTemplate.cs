namespace Morobot.Domain.Entities;

/// <summary>
/// A reusable process skeleton ("قالب"). A template owns the *structure* — the graph, and the
/// per-step settings an author would otherwise rebuild for every process — while the data sources
/// stay with the processes that were made from it.
/// </summary>
/// <remarks>
/// The distinction is the whole point of the feature. A template is published once and then kept
/// current: fixing a selector in the template must reach every process built on it, so a process
/// that is still attached carries a <see cref="Process.TemplateId"/> and inherits the template's
/// graph on save. What must NOT be inherited is the source data: two processes made from the same
/// template are meant to run on different spreadsheets, so the data-source links live on the
/// process and are never copied from the template.
///
/// Detaching (<see cref="Process.TemplateId"/> set to null) is therefore a real decision, not a
/// cosmetic one: a detached process stops receiving the template's later changes and keeps its own
/// copy of the graph from that moment on.
/// </remarks>
public class ProcessTemplate
{
    public int Id { get; set; }

    /// <summary>Display name of the template, shown in the template menus and on the info modal.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// The graph every attached process inherits: the same envelope-or-body document the editor
    /// writes for a process. Stored with the envelope intact so a template authored from a
    /// process keeps whatever envelope fields that process carried.
    /// </summary>
    public string? GraphJson { get; set; }

    /// <summary>
    /// Free-text note shown under the title on the info modal — what the template is for, and
    /// which fields an author is expected to fill in after creating a process from it.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Incremented on every publish. Attached processes record the value they last inherited so a
    /// stale one can be told apart from an up-to-date one, and the menus can show "there is a newer
    /// version of this template" without diffing the graphs.
    /// </summary>
    public int Version { get; set; } = 1;

    /// <summary>
    /// When false the template is hidden from the "create from template" menus but processes that
    /// already use it keep working — retiring a template must not break what was already built.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Who published the template. Nullable because the account may be removed later: the template
    /// itself is still valid and other people's processes may still depend on it, so the link is
    /// cleared rather than the template being dragged down with the user.
    /// </summary>
    public int? CreatorUserId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

    public AppUser? Creator { get; set; }

    /// <summary>
    /// The processes still attached to this template. A process that detaches clears its
    /// <see cref="Process.TemplateId"/> and therefore drops out of this collection.
    /// </summary>
    public ICollection<Process> Processes { get; set; } = new List<Process>();
}
