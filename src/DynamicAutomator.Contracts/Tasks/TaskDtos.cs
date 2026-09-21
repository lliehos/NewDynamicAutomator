namespace DynamicAutomator.Contracts.Tasks;

public class TaskListItemDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public int GroupCount { get; set; }
    public int StepCount { get; set; }
    public bool CanModify { get; set; }
    /// <summary>Manual or Recorded</summary>
    public string DesignOrigin { get; set; } = "Manual";
}

public class CreateTaskRequest
{
    public string Title { get; set; } = string.Empty;
    public int DelayBeforeMs { get; set; }
    public int DelayAfterMs { get; set; }
    public bool UseGlobalDataSources { get; set; }
    /// <summary>Manual (default) or Recorded</summary>
    public string? DesignOrigin { get; set; }
}
