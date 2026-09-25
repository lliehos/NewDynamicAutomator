namespace Morobot.Domain.Enums;

/// <summary>
/// What a condition inspects. Persisted by name and numeric value inside GraphJson, so existing
/// members must keep their numbers; new ones are appended.
/// </summary>
public enum ConditionType
{
    None = 0,
    Url,
    ElementValue,
    SourceValue,
    FindElement,
    NotFindElement,
    FindElements,
    DriverTabs,
    /// <summary>Compares the value held in a memory variable.</summary>
    MemoryValue,
    /// <summary>Compares the current system date (machine clock).</summary>
    SystemDate,
    /// <summary>Compares the current system time (machine clock).</summary>
    SystemTime
}
