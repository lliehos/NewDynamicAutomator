namespace Morobot.Domain.Entities;

public class Step
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public int? GroupId { get; set; }
    public int Priority { get; set; }
    public int? ActionId { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsConditional { get; set; }
    public int? CopyFromId { get; set; }

    public Group? Group { get; set; }
    public StepAction? Action { get; set; }
    public ICollection<ConditionGroup> ConditionGroups { get; set; } = new List<ConditionGroup>();
}
