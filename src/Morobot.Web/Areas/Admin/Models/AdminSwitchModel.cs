namespace Morobot.Web.Areas.Admin.Models;

public sealed class AdminSwitchModel
{
    public required string Name { get; init; }
    public required string Label { get; init; }
    public bool Checked { get; init; }
    public string? Id { get; init; }
    public string? Hint { get; init; }
    public bool Compact { get; init; }
    public string? Value { get; init; }
    public bool AutoSubmit { get; init; }
    public bool HideLabel { get; init; }
    public string? InputClass { get; init; }
}
