using Morobot.Domain.Enums;

namespace Morobot.Domain.Entities;

public class Group
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public int TaskId { get; set; }
    public int? ParentGroupId { get; set; }
    public int Priority { get; set; }
    public int? DataSourceId { get; set; }
    public int? SelectorId { get; set; }
    public RepeatSourceType SourceType { get; set; } = RepeatSourceType.None;
    public bool MoveLoop { get; set; } = true;
    public int? CopyFromId { get; set; }

    public AutomationTask Task { get; set; } = null!;
    public Group? ParentGroup { get; set; }
    public ICollection<Group> ChildGroups { get; set; } = new List<Group>();
    public DataSource? DataSource { get; set; }
    public Selector? Selector { get; set; }
    public ICollection<Step> Steps { get; set; } = new List<Step>();
    public ICollection<ConditionGroup> SuccessConditionGroups { get; set; } = new List<ConditionGroup>();
    public ICollection<ConditionGroup> FailedConditionGroups { get; set; } = new List<ConditionGroup>();
}
