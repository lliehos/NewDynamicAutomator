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

    /// <summary>
    /// Who last changed <see cref="Value"/>, and when. Kept on the row itself so the settings
    /// list can show it without scanning the event log, and so the answer survives log pruning.
    /// Null means nobody has edited it since it was seeded.
    /// </summary>
    public int? LastChangedByUserId { get; set; }
    public string? LastChangedByUserName { get; set; }
    public DateTime? LastChangedAtUtc { get; set; }
}
