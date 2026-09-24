namespace Morobot.Web.Areas.Admin.Models;

public sealed class AdminPresenceModel
{
    public bool Online { get; init; }
    public bool Playing { get; init; }
    public DateTime? LastSeenUtc { get; init; }
    public string Label { get; init; } = "";
    public string? Tooltip { get; init; }
}
