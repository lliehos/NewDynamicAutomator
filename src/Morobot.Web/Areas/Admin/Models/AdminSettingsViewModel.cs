using Morobot.Domain;
using Morobot.Domain.Entities;

namespace Morobot.Web.Areas.Admin.Models;

public sealed class AdminSettingsViewModel
{
    public required IReadOnlyList<SystemSetting> Settings { get; init; }
    public required IReadOnlyList<Plan> Plans { get; init; }

    /// <summary>
    /// How many fields a group actually renders.
    /// </summary>
    /// <remarks>
    /// Not the raw row count: an enable switch is drawn next to the colour it controls rather
    /// than as a field of its own, so counting it would tell the reader there is one more
    /// setting to review than they can see.
    /// </remarks>
    public int VisibleCount(IEnumerable<SystemSetting> group)
        => group.Count(s => !SystemSettingKeys.DiagramColorPairs.Any(p => p.EnabledSwitch == s.Key));
}
