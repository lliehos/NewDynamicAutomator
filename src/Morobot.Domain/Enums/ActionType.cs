namespace Morobot.Domain.Enums;

/// <summary>
/// The action a step performs. Persisted by name and numeric value inside GraphJson and consumed by
/// both extensions, so BOTH are frozen — new actions are appended, never inserted.
/// </summary>
public enum ActionType
{
    NoAction = 0,
    RemoveElements,
    RightClick,
    Click,
    DoubleClick,
    Hover,
    Hold,
    AlertAccept,
    Enter,
    Refresh,
    InputContent,
    LoadContent,
    SaveContent,
    InsertContent,
    TakeContent,
    WaitTime,
    GoToUrl,
    NewPage,
    ScrollPage,
    LoadCaptcha,
    Breakpoint,
    WaitForLoading,
    CloseLastTab,
    CloseFirstTab,
    /// <summary>Delete one row from a library data source.</summary>
    DeleteRow,
    /// <summary>Write a value into a memory variable.</summary>
    SetMemory,
    /// <summary>Read a value out of a memory variable (without touching the page).</summary>
    GetMemory,
    /// <summary>Clear the text of a page element.</summary>
    ClearContent,
    /// <summary>Select an option in a &lt;select&gt; element.</summary>
    SelectOption
}
