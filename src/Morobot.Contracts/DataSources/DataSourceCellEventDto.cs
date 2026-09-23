namespace Morobot.Contracts.DataSources;

/// <summary>Live cell access during play — broadcast to editor viewers via SignalR.</summary>
public class DataSourceCellEventDto
{
    public string TaskId { get; set; } = string.Empty;
    public long DataSourceId { get; set; }
    /// <summary>read | write</summary>
    public string Op { get; set; } = "read";
    public string ColumnKey { get; set; } = string.Empty;
    public int RowIndex { get; set; }
    public string? CellValue { get; set; }
    public string? StepTitle { get; set; }
    public string? UserName { get; set; }
}
