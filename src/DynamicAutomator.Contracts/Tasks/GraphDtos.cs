namespace DynamicAutomator.Contracts.Tasks;

public class GraphViewportDto
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Zoom { get; set; } = 1;
}

public class GraphNodeDto
{
    public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = "action";
    public int? EntityId { get; set; }
    public string Title { get; set; } = string.Empty;
    public double X { get; set; }
    public double Y { get; set; }
    public string? GroupNodeId { get; set; }
    public string? ActionType { get; set; }
    /// <summary>Obsolete — conditional branching is modeled with condition nodes, not per-action flags.</summary>
    public bool IsConditional { get; set; }
    public bool IsActive { get; set; } = true;
    public string? SelectorValue { get; set; }
    public string? FramePathJson { get; set; }
    /// <summary>When true, selector may contain {مقدار پویا} (or legacy {{Column}}) resolved from a data source row.</summary>
    public bool SelectorIsDynamic { get; set; }
    public string? SelectorDynamicColumn { get; set; }
    /// <summary>Optional override; otherwise parent group's DataSourceId is used.</summary>
    public int? SelectorDataSourceId { get; set; }
    /// <summary>When true, append [attr="value"] filter to the CSS selector.</summary>
    public bool HasAttribute { get; set; }
    public string? AttributeName { get; set; }
    /// <summary>When true, AttributeValue (or AttributeDynamicColumn) is resolved from a data-source row.</summary>
    public bool AttributeValueIsDynamic { get; set; }
    public string? AttributeValue { get; set; }
    public string? AttributeDynamicColumn { get; set; }
    public int? AttributeDataSourceId { get; set; }
    public string? ConstantValue { get; set; }
    public string? NavigateUrl { get; set; }
    public string? RepeatSourceType { get; set; }
    /// <summary>When RepeatSourceType is Loops — fixed iteration count.</summary>
    public int? LoopCount { get; set; }
    /// <summary>
    /// true = continue with parent loop index; false = independent index (restore parent after exit).
    /// Default: parent loop index.
    /// </summary>
    public bool MoveLoop { get; set; } = true;
    public int? DataSourceId { get; set; }

    /// <summary>Constant | DataSource | Elements | Memory — how step/condition value is resolved.</summary>
    public string? ContentSourceType { get; set; }
    /// <summary>Named play-memory variable for Memory content source (Take/Insert).</summary>
    public string? MemoryVariableName { get; set; }

    // --- Condition node fields (local-first graph) ---
    public string? ConditionType { get; set; }
    public string? EqualityType { get; set; }
    public string? ConstantEqualValue { get; set; }
    public string? DynamicSourceColumnName { get; set; }
    /// <summary>For Url conditions — optional pattern when ContentSourceType is Constant.</summary>
    public string? Navigation { get; set; }
    /// <summary>When ContentSourceType is Elements — selector whose text is the compare/value source.</summary>
    public string? EqualSelectorValue { get; set; }
    /// <summary>Dynamic flags for EqualSelectorValue (same {مقدار پویا} rules as main selector).</summary>
    public bool EqualSelectorIsDynamic { get; set; }
    public string? EqualSelectorDynamicColumn { get; set; }
    public int? EqualSelectorDataSourceId { get; set; }
    /// <summary>Attribute filter for EqualSelectorValue (same rules as HasAttribute).</summary>
    public bool EqualHasAttribute { get; set; }
    public string? EqualAttributeName { get; set; }
    public bool EqualAttributeValueIsDynamic { get; set; }
    public string? EqualAttributeValue { get; set; }
    public string? EqualAttributeDynamicColumn { get; set; }
    public int? EqualAttributeDataSourceId { get; set; }
}

public class DataSourceRefDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public List<string> ColumnKeys { get; set; } = new();
}

public class GraphEdgeDto
{
    public string Id { get; set; } = string.Empty;
    public string From { get; set; } = string.Empty;
    public string To { get; set; } = string.Empty;
    public string Kind { get; set; } = "next";
}

public class TaskGraphDto
{
    public int TaskId { get; set; }
    public string Title { get; set; } = string.Empty;
    public bool CanModify { get; set; }
    /// <summary>Manual or Recorded</summary>
    public string DesignOrigin { get; set; } = "Manual";
    public GraphViewportDto Viewport { get; set; } = new();
    public List<GraphNodeDto> Nodes { get; set; } = new();
    public List<GraphEdgeDto> Edges { get; set; } = new();
    public List<DataSourceRefDto> DataSources { get; set; } = new();
}

public class SaveTaskGraphRequest
{
    public string Title { get; set; } = string.Empty;
    public GraphViewportDto Viewport { get; set; } = new();
    public List<GraphNodeDto> Nodes { get; set; } = new();
    public List<GraphEdgeDto> Edges { get; set; } = new();
    public List<int> DeletedGroupIds { get; set; } = new();
    public List<int> DeletedStepIds { get; set; } = new();
    public List<int> DeletedConditionGroupIds { get; set; } = new();
}
