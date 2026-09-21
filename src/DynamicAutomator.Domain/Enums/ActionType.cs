namespace DynamicAutomator.Domain.Enums;

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
    CloseFirstTab
}
