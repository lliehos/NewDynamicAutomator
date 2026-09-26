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
    /// Not the raw row count. Superseded rows (the legacy AuthMode) are not drawn at all, and the
    /// retired per-colour diagram switches are filtered out of the page, so counting either would
    /// tell the reader there is more to review than they can see.
    /// </remarks>
    public int VisibleCount(IEnumerable<SystemSetting> group)
        => group.Count(s =>
            !SystemSettingKeys.IsSuperseded(s.Key)
            && !SystemSettingKeys.IsRetiredDiagramSwitch(s.Key));
}
