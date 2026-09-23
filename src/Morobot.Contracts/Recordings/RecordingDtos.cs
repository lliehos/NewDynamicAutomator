using Morobot.Domain.Enums;

namespace Morobot.Contracts.Recordings;

public class FrameSelectorDto
{
    public string By { get; set; } = "CssSelector";
    public string Value { get; set; } = string.Empty;
    public string? SrcHint { get; set; }
    public int? IndexInParent { get; set; }
}

public class RecordedActionDto
{
    public string ActionType { get; set; } = "Click";
    public string? Value { get; set; }
    public string? Url { get; set; }
    public string ElementBy { get; set; } = "CssSelector";
    public string ElementValue { get; set; } = string.Empty;
    public List<FrameSelectorDto> FramePath { get; set; } = new();
    public DateTimeOffset RecordedAt { get; set; }
}

public class SaveRecordingRequest
{
    public int? TaskId { get; set; }
    public string? NewTaskTitle { get; set; }
    public string? GroupTitle { get; set; }
    public List<RecordedActionDto> Actions { get; set; } = new();
}

public class SaveRecordingResponse
{
    public int TaskId { get; set; }
    public int GroupId { get; set; }
    public int StepCount { get; set; }
}
