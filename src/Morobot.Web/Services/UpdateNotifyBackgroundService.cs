using Morobot.Infrastructure.Services;

namespace Morobot.Web.Services;

/// <summary>Checks for updates periodically when licensed and caches availability for offline installs.</summary>
public sealed class UpdateNotifyBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<UpdateNotifyBackgroundService> _log;

    public UpdateNotifyBackgroundService(IServiceScopeFactory scopes, ILogger<UpdateNotifyBackgroundService> log)
    {
        _scopes = scopes;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
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
                await updates.CheckOnlineAsync(stoppingToken);
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                _log.LogDebug(ex, "Background update check skipped.");
            }

            await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
        }
    }
}
