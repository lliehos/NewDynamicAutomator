namespace Morobot.Domain.Entities;

public class ConditionGroup
{
    public int Id { get; set; }
    public int StepId { get; set; }
    public bool IsActive { get; set; } = true;
    public string Title { get; set; } = string.Empty;
    public int? SuccessGroupId { get; set; }
    public int? FailedGroupId { get; set; }
    public bool? BreakLoopOnFailed { get; set; }
    public bool? BreakLoopOnSuccess { get; set; }
    public int? CopyFromId { get; set; }

    public Step Step { get; set; } = null!;
    public Group? SuccessGroup { get; set; }
    public Group? FailedGroup { get; set; }
    public ICollection<Condition> Conditions { get; set; } = new List<Condition>();
}
