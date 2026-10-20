using Webautomator.Infrastructure.Services;

namespace Webautomator.Web.Areas.Admin.Models;

/// <summary>
/// Backing model for the monitoring dashboard.
/// </summary>
public sealed class MonitoringViewModel
{
    public MonitoringSnapshot Snapshot { get; init; } = new();

    /// <summary>Right-to-left layout (Persian) — drives digit/date formatting in the view.</summary>
    public bool IsRtl { get; init; }

    /// <summary>
    /// The master switch for server runs, mirrored from Admin → Settings. Turning it off stops every
    /// live server run, so the operator watching the live count is the one who most needs it here.
    /// </summary>
    public bool ServerRunEnabled { get; init; } = true;

    /// <summary>Only an Admin may flip it; a Monitor sees the state read-only.</summary>
    public bool CanToggleServerRun { get; init; }
}
