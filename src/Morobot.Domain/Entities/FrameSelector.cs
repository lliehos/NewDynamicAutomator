namespace Morobot.Domain.Entities;

/// <summary>One hop in an iframe chain (stored inside GraphJson framePath arrays — not a DB table).</summary>
public class FrameSelector
{
    public string By { get; set; } = "CssSelector";
    public string Value { get; set; } = string.Empty;
    public string? SrcHint { get; set; }
    public int? IndexInParent { get; set; }
}
