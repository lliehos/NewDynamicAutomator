namespace DynamicAutomator.Domain.Enums;

public enum OnFailedType
{
    None = 0,
    Retry,
    Skip,
    Stop,
    GoToStep
}
