using DynamicAutomator.Domain.Enums;

namespace DynamicAutomator.Domain.Entities;

public class Selector
{
    public int Id { get; set; }
    public SelectorBy ElementBy { get; set; } = SelectorBy.CssSelector;
    public string ElementValue { get; set; } = string.Empty;

    /// <summary>JSON array of <see cref="FrameSelector"/> from top document down to the leaf frame.</summary>
    public string FramePathJson { get; set; } = "[]";

    public int? MinDuration { get; set; }
    public int? MaxDuration { get; set; }
    public int? TryTimes { get; set; }
    public int? TryDelay { get; set; }
    public bool ElementDisplayed { get; set; }
    public bool ElementEnabled { get; set; }
    public bool ApplyElementState { get; set; }
    public bool IsDynamic { get; set; }
    public string? DynamicSourceColumnName { get; set; }
    public int? ElementSourceId { get; set; }
    /// <summary>When true, ElementValue is combined with [AttributeName="…"] at play time.</summary>
    public bool HasAttribute { get; set; }
    public string? AttributeName { get; set; }
    public bool AttributeValueIsDynamic { get; set; }
    public string? AttributeValue { get; set; }
    public string? AttributeDynamicColumn { get; set; }
    public int? AttributeDataSourceId { get; set; }
    public bool IsInShadowRoot { get; set; }
    public string? ShadowSelector { get; set; }
    public bool IsIndexDependent { get; set; }
    public int? CopyFromId { get; set; }

    public DataSource? ElementSource { get; set; }
    public ICollection<StepAction> Actions { get; set; } = new List<StepAction>();
    public ICollection<Condition> Conditions { get; set; } = new List<Condition>();
    public ICollection<Group> Groups { get; set; } = new List<Group>();
}
