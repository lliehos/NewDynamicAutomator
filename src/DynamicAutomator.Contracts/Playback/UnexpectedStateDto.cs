using DynamicAutomator.Domain.Enums;

namespace DynamicAutomator.Contracts.Playback;

public class UnexpectedStateDto
{
    public int TaskId { get; set; }
    public int? StepId { get; set; }
    public string Reason { get; set; } = string.Empty;
    public string? ExpectedSelector { get; set; }
    public string? ActualUrl { get; set; }
    public string? FramePathJson { get; set; }
}
