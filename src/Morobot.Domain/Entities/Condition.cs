using Morobot.Domain.Enums;

namespace Morobot.Domain.Entities;

public class Condition
{
    public int Id { get; set; }
    public int ConditionGroupId { get; set; }
    public ConditionType ConditionType { get; set; } = ConditionType.None;
    public int? Duration { get; set; }
    public string? Navigation { get; set; }
    public int? SelectorId { get; set; }
    public bool IsOr { get; set; }
    public bool IsActive { get; set; } = true;
    public string? ConstantEqualValue { get; set; }
    public ContentSourceType ContentSourceType { get; set; } = ContentSourceType.None;
    public string? DynamicSourceColumnName { get; set; }
    public EqualityType EqualityType { get; set; } = EqualityType.None;
    public int? SourceId { get; set; }
    public int? CopyFromId { get; set; }

    public ConditionGroup ConditionGroup { get; set; } = null!;
    public Selector? Selector { get; set; }
    public DataSource? Source { get; set; }
}
