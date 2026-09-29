namespace Morobot.Domain.Enums;

/// <summary>
/// The action a step performs.
/// </summary>
/// <remarks>
/// Persisted by NAME inside GraphJson, which is what both extensions switch on, so the name is the
/// real contract and a member must never be renamed. The numeric value is written as well, so the
/// numbers of surviving members are kept stable and new members take the next free number rather
/// than being inserted — renumbering would silently turn one action into another in any graph that
/// stored a number.
///
/// Gaps are deliberate. A removed member keeps its number reserved so a later action does not
/// inherit it and start impersonating the old one in an older graph. See the retired list at the
/// end of the enum.
/// </remarks>
public enum ActionType
{
    NoAction = 0,
    RemoveElements = 1,
    RightClick = 2,
    Click = 3,
    DoubleClick = 4,
    Hover = 5,
    Hold = 6,
    AlertAccept = 7,
    // 8 was Enter — removed. It is one of PressKey's keys (PressKey with keyName "Enter"), not a
    // separate action; a second name for the same behaviour only split the UI and the validator.
    Refresh = 9,
    InputContent = 10,
    LoadContent = 11,
    InsertContent = 12,
    // 13/14 were SaveContent and TakeContent — removed. The two were byte-identical in the player
    // AND in validation, and their jobs are covered: reading a source cell into a target is
    // LoadContent, writing a value into a source cell is InsertContent.
    WaitTime = 15,
    GoToUrl = 16,
    NewPage = 17,
    ScrollPage = 18,
    // 19 was LoadCaptcha — removed. It had no implementation and no agreed behaviour.
    // 20 was Breakpoint — removed. It did nothing (the player returned skipped), so it was a step
    // that looked like it paused the run but never did.
    WaitForLoading = 21,
    CloseLastTab = 22,
    CloseFirstTab = 23,
    /// <summary>Delete one row from a library data source.</summary>
    DeleteRow = 24,
    /// <summary>Write a value into a memory variable.</summary>
    SetMemory = 25,
    /// <summary>Read a value out of a memory variable (without touching the page).</summary>
    GetMemory = 26,
    /// <summary>Clear the text of a page element.</summary>
    ClearContent = 27,
    /// <summary>Select an option in a &lt;select&gt; element.</summary>
    SelectOption = 28,
    /// <summary>Send one keystroke to a page element. The key is chosen on the step.</summary>
    PressKey = 29,
    /// <summary>Move keyboard focus to a page element.</summary>
    FocusElement = 30,
    /// <summary>Scroll a page element into view.</summary>
    ScrollIntoView = 31
    // 32 was WaitForElement — removed. The per-step selector wait (selectorWaitEnabled /
    // selectorWaitMs) already gives every element action a wait budget, so a dedicated action
    // duplicated a setting every step already had.
    //
    // "Navigate" was never a member. The player accepted it as an alias of GoToUrl, which meant a
    // graph could name an action the editor could not produce and the enum did not declare.
}
