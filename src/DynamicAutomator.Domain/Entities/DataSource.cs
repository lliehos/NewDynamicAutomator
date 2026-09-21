namespace DynamicAutomator.Domain.Entities;

public class DataSource
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public int? UserId { get; set; }
    public bool IsGlobal { get; set; }
    public bool IsInsertable { get; set; } = true;
    public bool IsMergable { get; set; }
    public bool IsEditable { get; set; } = true;
    public bool IsPopable { get; set; }
    public int? CopyFromId { get; set; }

    /// <summary>JSON array of column names.</summary>
    public string ColumnsJson { get; set; } = "[]";

    public byte[]? RowVersion { get; set; }

    public AppUser? User { get; set; }
    public ICollection<DataSourceCell> Cells { get; set; } = new List<DataSourceCell>();
    public ICollection<AutomationTask> Tasks { get; set; } = new List<AutomationTask>();
    public ICollection<Group> Groups { get; set; } = new List<Group>();
    public ICollection<StepAction> Actions { get; set; } = new List<StepAction>();
    public ICollection<Condition> Conditions { get; set; } = new List<Condition>();
    public ICollection<Selector> Selectors { get; set; } = new List<Selector>();
}
