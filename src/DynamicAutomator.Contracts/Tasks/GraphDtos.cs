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
    public string Kind { get; set; } = "step";
    public int? EntityId { get; set; }
    public string Title { get; set; } = string.Empty;
    public double X { get; set; }
    public double Y { get; set; }
    public string? GroupNodeId { get; set; }
    public string? ActionType { get; set; }
    public bool IsConditional { get; set; }
    public bool IsActive { get; set; } = true;
    public string? SelectorValue { get; set; }
    public string? FramePathJson { get; set; }
    public string? ConstantValue { get; set; }
    public string? NavigateUrl { get; set; }
    public string? RepeatSourceType { get; set; }
    public bool MoveLoop { get; set; }
    public int? DataSourceId { get; set; }
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
