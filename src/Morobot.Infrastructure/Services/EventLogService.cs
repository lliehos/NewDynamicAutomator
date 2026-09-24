using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Morobot.Contracts.Auth;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Services;

public class EventLogService
{
    public static readonly TimeSpan OnlineThreshold = TimeSpan.FromMinutes(15);
    private readonly AppDbContext _db;

    public EventLogService(AppDbContext db) => _db = db;

    public async Task LogAsync(
        string level,
        string category,
        string eventType,
        string message,
        int? userId = null,
        string? userName = null,
        string? detailsJson = null,
        string? fingerprintHash = null,
        string? path = null,
        string? ipAddress = null,
        CancellationToken ct = default)
    {
        _db.EventLogs.Add(new AppEventLog
        {
            Level = Trunc(level, 20) ?? "Info",
            Category = Trunc(category, 40) ?? "System",
            EventType = Trunc(eventType, 80) ?? "Unknown",
            Message = Trunc(message, 2000) ?? "",
            UserId = userId is > 0 ? userId : null,
            UserName = Trunc(userName, 80),
            DetailsJson = detailsJson,
            FingerprintHash = Trunc(fingerprintHash, 128),
            Path = Trunc(path, 400),
            IpAddress = Trunc(ipAddress, 64),
            CreatedAtUtc = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);
    }

    public Task LogClientAsync(int? userId, string? userName, ClientEventRequest req, string? ip, CancellationToken ct = default)
        => LogAsync(
            req.Level,
            req.Category,
            string.IsNullOrWhiteSpace(req.EventType) ? "ClientEvent" : req.EventType,
            string.IsNullOrWhiteSpace(req.Message) ? "(empty)" : req.Message,
            userId,
            userName,
            req.DetailsJson,
            req.Device?.FingerprintHash,
            req.Path,
            ip,
            ct);

    public async Task<List<AppEventLog>> ListAsync(string? level, string? category, int take, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 500);
        var q = _db.EventLogs.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(level))
            q = q.Where(x => x.Level == level);
        if (!string.IsNullOrWhiteSpace(category))
            q = q.Where(x => x.Category == category);
        return await q.OrderByDescending(x => x.Id).Take(take).ToListAsync(ct);
    }

    public async Task UpsertDeviceSessionAsync(
        int userId,
        string? claimedUserName,
        DeviceFingerprintDto? device,
        string? ip,
        CancellationToken ct = default)
    {
        var hash = NormalizeFingerprint(device);
        if (string.IsNullOrEmpty(hash))
            hash = "unknown";

        var session = await _db.DeviceSessions
            .FirstOrDefaultAsync(d => d.UserId == userId && d.FingerprintHash == hash, ct);
        if (session is null)
        {
            session = new DeviceSession
            {
                UserId = userId,
                FingerprintHash = hash,
                FirstSeenUtc = DateTime.UtcNow,
                LoginCount = 0
            };
            _db.DeviceSessions.Add(session);
        }

        session.ClaimedUserName = Trunc(claimedUserName, 80);
        session.MachineFingerprint = Trunc(NormalizeMachineFingerprint(device), 128);
        session.UserAgent = Trunc(device?.UserAgent, 512);
        session.Platform = Trunc(device?.Platform, 120);
        session.Language = Trunc(device?.Language, 40);
        session.TimeZone = Trunc(device?.TimeZone, 80);
        session.Screen = Trunc(device?.Screen, 40);
        session.HardwareConcurrency = device?.HardwareConcurrency;
        session.IpAddress = Trunc(ip, 64);
        session.DetailsJson = device?.DetailsJson;
        session.LastSeenUtc = DateTime.UtcNow;
        session.LoginCount += 1;
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// If this machine already has a Local-plan user, return that user id (anti multi-guest via multi-browser).
    /// </summary>
    public async Task<int?> FindLocalUserIdByMachineAsync(string? machineFingerprint, CancellationToken ct = default)
    {
        var mf = (machineFingerprint ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(mf) || mf == "unknown" || mf == "na")
            return null;

        var hit = await _db.DeviceSessions.AsNoTracking()
            .Where(d => d.MachineFingerprint == mf)
            .Join(_db.Users.Include(u => u.Plan),
                d => d.UserId,
                u => u.Id,
                (d, u) => new { d.UserId, PlanCode = u.Plan != null ? u.Plan.Code : null, u.IsActive })
            .Where(x => x.IsActive && x.PlanCode == nameof(PlanCode.Local))
            .OrderBy(x => x.UserId)
            .FirstOrDefaultAsync(ct);

        return hit?.UserId;
    }

    public async Task<List<DeviceSession>> ListDevicesAsync(int take, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 500);
        return await _db.DeviceSessions.AsNoTracking()
            .Include(d => d.User)
            .OrderByDescending(d => d.LastSeenUtc)
            .Take(take)
            .ToListAsync(ct);
    }

    public async Task<Dictionary<int, DateTime>> GetLastSeenByUserAsync(CancellationToken ct = default)
    {
        return await _db.DeviceSessions.AsNoTracking()
            .GroupBy(d => d.UserId)
            .Select(g => new { UserId = g.Key, LastSeenUtc = g.Max(x => x.LastSeenUtc) })
            .ToDictionaryAsync(x => x.UserId, x => x.LastSeenUtc, ct);
    }

    public async Task TouchPresenceAsync(int userId, CancellationToken ct = default)
    {
        if (userId <= 0) return;
        var now = DateTime.UtcNow;
        var updated = await _db.DeviceSessions
            .Where(d => d.UserId == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.LastSeenUtc, now), ct);
        if (updated == 0)
        {
            _db.DeviceSessions.Add(new DeviceSession
            {
                UserId = userId,
                FingerprintHash = "presence",
                FirstSeenUtc = now,
                LastSeenUtc = now,
                LoginCount = 0
            });
            await _db.SaveChangesAsync(ct);
        }
    }

    public static bool IsOnline(DateTime? lastSeenUtc, bool isPlaying, DateTime utcNow)
    {
        if (isPlaying) return true;
        if (lastSeenUtc is null) return false;
        return utcNow - lastSeenUtc.Value <= OnlineThreshold;
    }

    public static string NormalizeFingerprint(DeviceFingerprintDto? device)
    {
        var machine = NormalizeMachineFingerprint(device);
        if (!string.IsNullOrEmpty(machine))
            return machine;

        if (!string.IsNullOrWhiteSpace(device?.FingerprintHash))
            return device.FingerprintHash.Trim().ToLowerInvariant();

        return "";
    }

    /// <summary>Cross-browser machine id — excludes userAgent.</summary>
    public static string NormalizeMachineFingerprint(DeviceFingerprintDto? device)
    {
        if (!string.IsNullOrWhiteSpace(device?.MachineFingerprint))
            return device.MachineFingerprint.Trim().ToLowerInvariant();

        // Prefer client fingerprintHash when it is already the machine hash (da-device.js).
        if (!string.IsNullOrWhiteSpace(device?.FingerprintHash)
            && string.IsNullOrWhiteSpace(device.BrowserFingerprint))
            return device.FingerprintHash.Trim().ToLowerInvariant();

        var raw = string.Join("|",
            device?.Platform,
            device?.TimeZone,
            device?.Screen,
            device?.HardwareConcurrency);
        if (string.IsNullOrWhiteSpace(raw.Replace("|", "")))
            return "";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string? Trunc(string? s, int max)
        => string.IsNullOrEmpty(s) ? s : (s.Length <= max ? s : s[..max]);
}
