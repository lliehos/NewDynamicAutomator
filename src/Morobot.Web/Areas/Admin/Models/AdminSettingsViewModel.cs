using Morobot.Domain.Entities;

namespace Morobot.Web.Areas.Admin.Models;

public sealed class AdminSettingsViewModel
{
    public required IReadOnlyList<SystemSetting> Settings { get; init; }
    public required IReadOnlyList<Plan> Plans { get; init; }
}
