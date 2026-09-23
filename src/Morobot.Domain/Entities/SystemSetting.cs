namespace Morobot.Domain.Entities;

/// <summary>Admin-managed static system parameters (key/value).</summary>
public class SystemSetting
{
    public int Id { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string Group { get; set; } = "General";
    public string LabelFa { get; set; } = string.Empty;
    public string LabelEn { get; set; } = string.Empty;
    public string? HintFa { get; set; }
    public string? HintEn { get; set; }
}
