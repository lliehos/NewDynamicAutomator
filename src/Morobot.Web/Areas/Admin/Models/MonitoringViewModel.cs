using Morobot.Infrastructure.Services;

namespace Morobot.Web.Areas.Admin.Models;

/// <summary>
/// Backing model for the monitoring dashboard.
/// </summary>
public sealed class MonitoringViewModel
{
    public MonitoringSnapshot Snapshot { get; init; } = new();

    /// <summary>Right-to-left layout (Persian) — drives digit/date formatting in the view.</summary>
    public bool IsRtl { get; init; }
}
