using Microsoft.AspNetCore.SignalR;
using Morobot.Contracts.Licensing;
using Morobot.Infrastructure.Services;
using Morobot.Web.Hubs;

namespace Morobot.Web.Services;

/// <summary>
/// Checks for updates periodically when licensed, caches availability for offline
/// installs, and pushes a notification to the admin SignalR group the first time a
/// given version becomes available so an admin sees it without refreshing.
/// </summary>
public sealed class UpdateNotifyBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IHubContext<CatalogHub> _hub;
    private readonly ILogger<UpdateNotifyBackgroundService> _log;

    public UpdateNotifyBackgroundService(
        IServiceScopeFactory scopes,
        IHubContext<CatalogHub> hub,
        ILogger<UpdateNotifyBackgroundService> log)
    {
        _scopes = scopes;
        _hub = hub;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Remember what we last announced so the admin is told once per version,
        // not once per poll. Reset on restart, which is acceptable: a restart means
        // new code, so re-announcing is the safer direction.
        string? lastAnnounced = null;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var license = scope.ServiceProvider.GetRequiredService<LicenseService>();
                var runtime = await license.GetRuntimeStateAsync(stoppingToken);
                if (!runtime.AllowsUpdates)
                {
                    await Task.Delay(TimeSpan.FromHours(12), stoppingToken);
                    continue;
                }

                var updates = scope.ServiceProvider.GetRequiredService<UpdateCheckService>();
                var status = await updates.CheckOnlineAsync(stoppingToken);

                var available = status.AvailableVersion;
                if (!string.IsNullOrWhiteSpace(available)
                    && !string.Equals(available, lastAnnounced, StringComparison.OrdinalIgnoreCase))
                {
                    lastAnnounced = available;
                    await NotifyAdminsAsync(status, stoppingToken);
                }
                else if (string.IsNullOrWhiteSpace(available))
                {
                    // Update withdrawn / superseded — allow a future re-announce.
                    lastAnnounced = null;
                }
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                _log.LogDebug(ex, "Background update check skipped.");
            }

            await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
        }
    }

    /// <summary>
    /// Tell the admin group a new version exists. The client is already the
    /// authority on how to present it — this only carries the facts, so the
    /// notification is not coupled to any particular UI wording.
    /// </summary>
    private async Task NotifyAdminsAsync(UpdateCheckResultDto status, CancellationToken ct)
    {
        try
        {
            await _hub.Clients.Group(CatalogHub.AdminGroup).SendAsync("updateAvailable", new
            {
                version = status.AvailableVersion,
                currentVersion = status.CurrentVersion,
                notes = status.ReleaseNotes,
                downloadUrl = status.DownloadUrl,
                checkedAtUtc = status.LastCheckUtc ?? DateTime.UtcNow
            }, ct);
            _log.LogInformation("Announced update {Version} to the admin group.", status.AvailableVersion);
        }
        catch (Exception ex)
        {
            // A notification failure must never break the polling loop.
            _log.LogDebug(ex, "Could not broadcast the update notification.");
        }
    }
}
