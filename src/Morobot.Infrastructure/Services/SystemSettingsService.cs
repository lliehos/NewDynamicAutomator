using Morobot.Domain;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Services;

public class SystemSettingsService
{
    private readonly AppDbContext _db;

    public SystemSettingsService(AppDbContext db) => _db = db;

    public async Task<string> GetAsync(string key, string fallback, CancellationToken ct = default)
    {
        var row = await _db.SystemSettings.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Key == key, ct);
        return string.IsNullOrWhiteSpace(row?.Value) ? fallback : row!.Value.Trim();
    }

    public async Task<Plan> GetDefaultRegisterPlanAsync(CancellationToken ct = default)
    {
        var code = await GetAsync(SystemSettingKeys.DefaultRegisterPlan, nameof(PlanCode.Free), ct);
        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Code == code && p.IsActive, ct)
                   ?? await _db.Plans.FirstAsync(p => p.Code == nameof(PlanCode.Free), ct);
        return plan;
    }

    public Task<List<SystemSetting>> ListAsync(CancellationToken ct = default) =>
        _db.SystemSettings.OrderBy(s => s.Group).ThenBy(s => s.Key).ToListAsync(ct);

    public async Task SaveAsync(IEnumerable<(string key, string value)> pairs, CancellationToken ct = default)
    {
        var keys = pairs.Select(p => p.key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rows = await _db.SystemSettings.Where(s => keys.Contains(s.Key)).ToListAsync(ct);
        foreach (var (key, value) in pairs)
        {
            var row = rows.FirstOrDefault(r => string.Equals(r.Key, key, StringComparison.OrdinalIgnoreCase));
            if (row is null) continue;
            row.Value = (value ?? "").Trim();
        }
        await _db.SaveChangesAsync(ct);
    }
}
