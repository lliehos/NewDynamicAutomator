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
    // 17 was NewPage — removed. Opening a tab belongs to the run's own navigation, not to a step.
    ScrollPage = 18,
    // 19 was LoadCaptcha — removed. It had no implementation and no agreed behaviour.
    // 20 was Breakpoint — removed. It did nothing (the player returned skipped), so it was a step
    // that looked like it paused the run but never did.
    WaitForLoading = 21,
    /// <summary>
    /// Close one tab. Which one is chosen on the step: first, last, next or previous.
    /// </summary>
    /// <remarks>
    /// 22/23 were CloseLastTab and CloseFirstTab. They differed only in which tab they closed, so
    /// the two became one action with a target — the same reasoning that removed the per-language
    /// brand titles. The numbers are left as gaps rather than reused.
    /// </remarks>
    CloseTab = 22,
    /// <summary>Delete one row from a library data source. Which row is chosen on the step.</summary>
    DeleteRow = 24,
    /// <summary>Write a value into a memory variable.</summary>
    SetMemory = 25,
    // 26 was GetMemory — removed. Reading a variable back only fed the step's own value, which
    // every value-taking action can already do by choosing «حافظه» as its value source.
    /// <summary>Clear the text of a page element.</summary>
    ClearContent = 27,
    /// <summary>Select an option in a &lt;select&gt; element.</summary>
    SelectOption = 28,
    // 29 was PressKey — removed. Sending a key is not a job of its own once Enter is gone.
    // 30 was FocusElement — removed.
    // 31 was ScrollIntoView — removed. It is ScrollPage with its type set to "to element".
    // 32 was WaitForElement — removed. The per-step selector wait (selectorWaitEnabled /
    // selectorWaitMs) already gives every element action a wait budget, so a dedicated action
    // duplicated a setting every step already had.
    //
    // "Navigate" was never a member. The player accepted it as an alias of GoToUrl, which meant a
    // graph could name an action the editor could not produce and the enum did not declare.

    /// <summary>Go back one entry in the tab's browser history.</summary>
    GoBack = 33,
    /// <summary>Go forward one entry in the tab's browser history.</summary>
    GoForward = 34,
    /// <summary>
    /// Insert a blank row into a library data source, at a chosen position.
    /// The columns come from the source itself; the new row starts empty.
    /// </summary>
    InsertRow = 35
}
