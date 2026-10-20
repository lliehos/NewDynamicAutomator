using Webautomator.Infrastructure.Services;

namespace Webautomator.Web.Services;

/// <summary>
/// The identity this deployment's extension pairing uses.
///
/// It is the SERVER HOST fingerprint — the same value the licence binds to and shows (Admin →
/// Licence, e.g. `ee1d678e3122…`) — so there is one identity everywhere: the licence, the panel,
/// and the `webautomator-binding.json` an extension carries. It is stable across restarts and unique
/// per server, which is the deployment model: one deployment per server.
///
/// The deployment instance id is recorded alongside for diagnostics, but the fingerprint does NOT
/// depend on the database — it is available from the first moment the app starts.
/// </summary>
public sealed class DeploymentFingerprintService
{
    public sealed record DeploymentFingerprint(string? InstanceId, string AppInstanceKey, string Fingerprint);

    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _config;
    private volatile DeploymentFingerprint? _cached;

    public DeploymentFingerprintService(
        IServiceScopeFactory scopes,
        IConfiguration config)
    {
        _scopes = scopes;
        _config = config;
    }

    /// <summary>
    /// Synchronous accessor for payload building. The fingerprint part never blocks on the database;
    /// the instance id is filled in when the database is available.
    /// </summary>
    public DeploymentFingerprint? TryGet() => TryGetAsync().GetAwaiter().GetResult();

    public async Task<DeploymentFingerprint?> TryGetAsync(CancellationToken ct = default)
    {
        var cached = _cached;
        if (cached != null && cached.InstanceId != null) return cached;

        string? instanceId = cached?.InstanceId;
        if (instanceId == null)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var binding = scope.ServiceProvider.GetRequiredService<DeploymentBindingService>();
                instanceId = (await binding.GetCurrentInstanceIdAsync(ct)).ToString("D");
            }
            catch
            {
                // Database not migrated yet: diagnostics only, never worth failing the fingerprint for.
            }
        }

        var appKey = cached?.AppInstanceKey ?? ExtensionInstallPathHelper.ResolveAppInstanceKey(_config);
        var fingerprint = cached?.Fingerprint ?? ServerHostFingerprint.ComputeHash();
        var record = new DeploymentFingerprint(instanceId, appKey, fingerprint);
        _cached = record;
        return record;
    }
}
