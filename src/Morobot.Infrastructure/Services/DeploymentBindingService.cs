using Microsoft.EntityFrameworkCore;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Morobot.Licensing;

namespace Morobot.Infrastructure.Services;

/// <summary>
/// Binds tenant data (users, processes) to the current deployment trial instance.
/// Valid signed license bypasses binding checks and rebinds all rows on import.
/// </summary>
public sealed class DeploymentBindingService
{
    private readonly AppDbContext _db;
    private readonly LicenseService _license;

    public DeploymentBindingService(AppDbContext db, LicenseService license)
    {
        _db = db;
        _license = license;
    }

    public Task<Guid> GetCurrentInstanceIdAsync(CancellationToken ct = default)
        => _license.GetCurrentDeploymentInstanceIdAsync(ct);

    public async Task<bool> IsLicensedBypassAsync(CancellationToken ct = default)
    {
        var runtime = await _license.GetRuntimeStateAsync(ct);
        return runtime.Mode == LicenseRuntimeMode.Licensed;
    }

    public async Task<bool> IsRecordBoundAsync(Guid? boundInstanceId, CancellationToken ct = default)
    {
        if (await IsLicensedBypassAsync(ct))
            return true;
        if (boundInstanceId is null)
            return false;
        return boundInstanceId == await GetCurrentInstanceIdAsync(ct);
    }

    public async Task<bool> IsUserUsableAsync(AppUser user, CancellationToken ct = default)
    {
        if (user.Role == UserRole.Admin)
            return true;
        return await IsRecordBoundAsync(user.DeploymentInstanceId, ct);
    }

    public async Task<bool> IsProcessAccessibleAsync(int processId, CancellationToken ct = default)
    {
        if (await IsLicensedBypassAsync(ct))
            return true;

        var bound = await _db.Processes.AsNoTracking()
            .Where(p => p.Id == processId)
            .Select(p => p.DeploymentInstanceId)
            .FirstOrDefaultAsync(ct);
        return await IsRecordBoundAsync(bound, ct);
    }

    public async Task StampUserAsync(AppUser user, CancellationToken ct = default)
        => user.DeploymentInstanceId = await GetCurrentInstanceIdAsync(ct);

    public async Task StampProcessAsync(Process process, CancellationToken ct = default)
        => process.DeploymentInstanceId = await GetCurrentInstanceIdAsync(ct);

    public async Task RebindAllTenantDataAsync(CancellationToken ct = default)
        => await _license.RebindAllTenantDataToCurrentDeploymentAsync(ct);
}
