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

    /// <summary>
    /// True when a row for this key exists at all, regardless of its value. Used to tell "this
    /// install has never had the setting" (fall back to a legacy key) from "the setting is present
    /// but blank/false".
    /// </summary>
    public Task<bool> ExistsAsync(string key, CancellationToken ct = default) =>
        _db.SystemSettings.AsNoTracking().AnyAsync(s => s.Key == key, ct);

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
        => await SaveAsync(pairs, actorUserId: null, actorUserName: null, ct);

    /// <summary>
    /// Persist setting values, recording who made the change.
    /// </summary>
    /// <remarks>
    /// Only rows whose value actually differs are touched. Without that check, opening the form
    /// and pressing save — or a page that re-posts unchanged values — would rewrite every row and
    /// make "last changed by" name whoever last loaded the page rather than whoever last changed
    /// something, which is worse than not showing it at all.
    /// </remarks>
    public async Task SaveAsync(
        IEnumerable<(string key, string value)> pairs,
        int? actorUserId,
        string? actorUserName,
        CancellationToken ct = default)
    {
        var list = pairs.ToList();
        var keys = list.Select(p => p.key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rows = await _db.SystemSettings.Where(s => keys.Contains(s.Key)).ToListAsync(ct);
        var changed = new List<(string Key, string From, string To)>();

        foreach (var (key, value) in list)
        {
            var row = rows.FirstOrDefault(r => string.Equals(r.Key, key, StringComparison.OrdinalIgnoreCase));
            if (row is null) continue;
            var next = (value ?? "").Trim();
            if (string.Equals(row.Value, next, StringComparison.Ordinal)) continue;

            changed.Add((row.Key, row.Value, next));
            row.Value = next;
            row.LastChangedByUserId = actorUserId is > 0 ? actorUserId : null;
            row.LastChangedByUserName = string.IsNullOrWhiteSpace(actorUserName) ? null : actorUserName;
            row.LastChangedAtUtc = DateTime.UtcNow;
        }

        if (changed.Count == 0) return;

        await _db.SaveChangesAsync(ct);

        // The row records the latest change; the event log keeps the sequence, so "who changed
        // this, from what to what, and when" is answerable for more than just the last edit.
        // Values are included because an audit trail that only says a setting changed is not
        // enough to explain a behaviour difference between two days.
        foreach (var (key, from, to) in changed)
        {
            _db.EventLogs.Add(new AppEventLog
            {
                Level = "Audit",
                Category = "Settings",
                EventType = "SettingChanged",
                Message = $"Setting '{key}' changed",
                UserId = actorUserId is > 0 ? actorUserId : null,
                UserName = string.IsNullOrWhiteSpace(actorUserName) ? null : actorUserName,
                DetailsJson = System.Text.Json.JsonSerializer.Serialize(new { key, from, to }),
                CreatedAtUtc = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync(ct);
    }

    public async Task SetAsync(string key, string value, CancellationToken ct = default)
        => await SetAsync(key, value, actorUserId: null, actorUserName: null, ct);

    /// <summary>
    /// Write one setting, recording who changed it.
    /// </summary>
    /// <remarks>
    /// Shares the change-recording behaviour with <see cref="SaveAsync(IEnumerable{ValueTuple{string, string}}, int?, string?, CancellationToken)"/>
    /// so every path that edits settings — the settings form, branding, licence import — leaves
    /// the same trail. An unchanged write is a no-op, so a service that re-applies the value it
    /// already had does not claim a change nobody made.
    /// </remarks>
    public async Task SetAsync(
        string key,
        string value,
        int? actorUserId,
        string? actorUserName,
        CancellationToken ct = default)
    {
        var row = await _db.SystemSettings.FirstOrDefaultAsync(s => s.Key == key, ct);
        if (row is null)
        {
            // The settings table is seeded by DbSeeder; a missing key means the caller wrote to
            // a key that was never declared there. Silently dropping the write makes the feature
            // look broken with no error anywhere, so surface it instead.
            throw new InvalidOperationException(
                $"System setting '{key}' does not exist. Add it to DbSeeder so a row is created, " +
                "otherwise the value cannot be persisted.");
        }

        var next = (value ?? "").Trim();
        if (string.Equals(row.Value, next, StringComparison.Ordinal)) return;

        var from = row.Value;
        row.Value = next;
        row.LastChangedByUserId = actorUserId is > 0 ? actorUserId : null;
        row.LastChangedByUserName = string.IsNullOrWhiteSpace(actorUserName) ? null : actorUserName;
        row.LastChangedAtUtc = DateTime.UtcNow;

        _db.EventLogs.Add(new AppEventLog
        {
            Level = "Audit",
            Category = "Settings",
            EventType = "SettingChanged",
            Message = $"Setting '{key}' changed",
            UserId = actorUserId is > 0 ? actorUserId : null,
            UserName = string.IsNullOrWhiteSpace(actorUserName) ? null : actorUserName,
            DetailsJson = System.Text.Json.JsonSerializer.Serialize(new { key, from, to = next }),
            CreatedAtUtc = DateTime.UtcNow
        });

        await _db.SaveChangesAsync(ct);
    }
}
