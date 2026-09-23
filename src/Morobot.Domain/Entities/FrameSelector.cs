using Morobot.Domain.Enums;

namespace Morobot.Domain.Entities;

/// <summary>
/// One hop in a nested iframe/frame chain from the top document downward.
/// </summary>
public sealed class FrameSelector
{
    public SelectorBy By { get; set; } = SelectorBy.CssSelector;
    public string Value { get; set; } = string.Empty;
    public string? SrcHint { get; set; }
    public int? IndexInParent { get; set; }
}
