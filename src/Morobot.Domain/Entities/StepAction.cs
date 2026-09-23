using Morobot.Domain.Enums;

namespace Morobot.Domain.Entities;

public class StepAction
{
    public int Id { get; set; }
    public ActionType ActionType { get; set; } = ActionType.NoAction;
    public string? ConstantValue { get; set; }
    public string? NavigateUrl { get; set; }
    public int? WaitTimeDuration { get; set; }
    public ContentSourceType ContentSourceType { get; set; } = ContentSourceType.None;
    public string? DynamicSourceColumnName { get; set; }
    public int? SelectorId { get; set; }
    public OnFailedType OnFailedType { get; set; } = OnFailedType.None;
    public byte? FailedRetryTimes { get; set; }
    public int? OnFailedStepId { get; set; }
    public int? FailedDelayBeforeRetry { get; set; }
    public int? SaveSourceId { get; set; }
    public RowIndexType RowIndexType { get; set; } = RowIndexType.None;
    public int? ColumnsCount { get; set; }
    public int? CopyFromId { get; set; }

    public Selector? Selector { get; set; }
    public DataSource? SaveSource { get; set; }
    public ICollection<Step> Steps { get; set; } = new List<Step>();
}
