using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Webautomator.Domain;
using Webautomator.Domain.Entities;
using Webautomator.Infrastructure.Persistence;
// The domain has its own `Process` entity, so the diagnostics type is aliased rather than imported.
using SysProcess = System.Diagnostics.Process;

namespace Webautomator.Infrastructure.Services;

/// <summary>One connected user, and how much of this application's traffic is theirs.</summary>
public sealed class MonitoringUserSlice
{
    /// <summary>The user id, or 0 for the row that collects unauthenticated traffic.</summary>
    public int UserId { get; init; }

    public string UserName { get; init; } = "";

    /// <summary>Every address this user was seen from in the window, joined for display.</summary>
    public string Ips { get; init; } = "";

    public long BytesIn { get; init; }
    public long BytesOut { get; init; }
    public long BytesTotal => BytesIn + BytesOut;

    /// <summary>
    /// Server-side runs (registered play sessions) this user has in flight right now. On the anonymous
    /// row this is the number of runs that were started without an identity.
    /// </summary>
    public int ActiveRuns { get; init; }

    public DateTime? LastSeenUtc { get; init; }
    public bool IsOnline { get; init; }

    /// <summary>True for the aggregate row of everything that arrived without an identity.</summary>
    public bool IsAnonymous => UserId <= 0;
}

/// <summary>One client address's share of the application's traffic.</summary>
public sealed class MonitoringIpSlice
{
    public string Ip { get; init; } = "";
    public long BytesIn { get; init; }
    public long BytesOut { get; init; }
    public long BytesTotal => BytesIn + BytesOut;

    /// <summary>How many distinct accounts were seen from this address in the window.</summary>
    public int Users { get; init; }

    public DateTime? LastSeenUtc { get; init; }
}

/// <summary>One bucket of the traffic chart.</summary>
public sealed class MonitoringPoint
{
    public DateTime AtUtc { get; init; }
    public long BytesIn { get; init; }
    public long BytesOut { get; init; }
    public int OnlineUsers { get; init; }
    public int LiveSessions { get; init; }
}

/// <summary>Everything the monitoring dashboard shows in one reading.</summary>
public sealed class MonitoringSnapshot
{
    public DateTime CapturedAtUtc { get; init; }
    public bool DatabaseReachable { get; init; }
    public double DatabasePingMs { get; init; }

    /// <summary>Bytes this application has served and received since it started.</summary>
    public long NetworkReceivedBytes { get; init; }
    public long NetworkSentBytes { get; init; }

    /// <summary>Bytes per second, from the difference between the two newest stored samples.</summary>
    public long NetworkInPerSec { get; init; }
    public long NetworkOutPerSec { get; init; }

    /// <summary>Bytes in the selected window, so "last hour" answers with a number and not a slope.</summary>
    public long WindowBytesIn { get; init; }
    public long WindowBytesOut { get; init; }

    /// <summary>Registered play sessions in flight right now.</summary>
    public int LiveSessions { get; init; }

    public int OnlineUsers { get; init; }
    public int DistinctIpCount { get; init; }
    public int WindowHours { get; init; }

    /// <summary>The administrator's stop-all switch, as stored.</summary>
    public bool StopAllServerRuns { get; init; }

    public IReadOnlyList<MonitoringPoint> History { get; init; } = Array.Empty<MonitoringPoint>();
    public IReadOnlyList<MonitoringUserSlice> ByUser { get; init; } = Array.Empty<MonitoringUserSlice>();
    public IReadOnlyList<MonitoringIpSlice> ByIp { get; init; } = Array.Empty<MonitoringIpSlice>();
}

/// <summary>
/// Reads the monitoring dashboard's data: this application's own HTTP traffic (how much, and whose),
/// who is connected, and which runs are in flight.
/// </summary>
/// <remarks>
/// NETWORK ONLY, on purpose. An earlier version of this page mixed in the host's memory, CPU, threads
/// and disk plus a process/data-source breakdown, and the answer to "what is this deployment doing to
/// the network, and who is generating it" was buried among numbers that say nothing about traffic —
/// and that, on a shared box, describe the neighbours as much as this application. The resources are
/// still SAMPLED (see the sampler service) because they are cheap to keep; they are simply not what
/// this dashboard is for.
///
/// Traffic comes from <see cref="TrafficMeter"/>, which counts bytes in the request pipeline, so every
/// figure here is this application's own traffic. The per-user and per-address split is exact for
/// requests that reach the application; traffic a user's browser generates elsewhere never passes
/// through here and is not guessed at.
/// </remarks>
public class MonitoringService
{
    /// <summary>
    /// How many buckets the traffic chart is built from, whatever the window length.
    /// </summary>
    /// <remarks>
    /// The stored series is one sample per minute, so a two-week window is twenty thousand points.
    /// Sending those to the browser would make the page heavy and the chart unreadable, and no screen
    /// has twenty thousand columns to draw them in — the series is collapsed to a fixed number of
    /// buckets here, where the whole range is known.
    /// </remarks>
    private const int ChartBuckets = 60;

    private readonly AppDbContext _db;
    private readonly SystemSettingsService _settings;

    public MonitoringService(AppDbContext db, SystemSettingsService settings)
    {
        _db = db;
        _settings = settings;
    }

    // ---- Raw process counters -------------------------------------------------------------------

    /// <summary>
    /// Read this process's own cumulative disk and network counters for the sampler to store.
    /// </summary>
    /// <remarks>
    /// These are PER-PROCESS and CUMULATIVE. .NET exposes no per-process NETWORK byte counter (it is a
    /// socket-level fact, not a process counter), so the network figures come from what the app itself
    /// has served and received — see <see cref="TrafficMeter"/>.
    /// </remarks>
    public static ProcessCounters ReadCounters(SysProcess proc)
    {
        _ = proc;
        return new ProcessCounters(0, 0, TrafficMeter.BytesIn, TrafficMeter.BytesOut);
    }

    /// <summary>The process's own cumulative IO counters.</summary>
    public readonly record struct ProcessCounters(long DiskRead, long DiskWrite, long NetIn, long NetOut);

    // ---- Capture --------------------------------------------------------------------------------

    /// <summary>
    /// Take one reading over <paramref name="windowHours"/>.
    /// </summary>
    /// <param name="playingSessionUserIds">
    /// One entry per running play session (the owning user id, or null when the session has no
    /// identity). Duplicates mean the same user is running more than one process, which is why the
    /// caller passes ids rather than a distinct count: the number of RUNS and the number of USERS are
    /// two different answers, and the page shows both.
    /// </param>
    public async Task<MonitoringSnapshot> CaptureAsync(
        IReadOnlyList<int?> playingSessionUserIds,
        int windowHours = 24,
        CancellationToken ct = default)
    {
        windowHours = Math.Clamp(windowHours, 1, 24 * 30);
        var now = DateTime.UtcNow;
        var since = now.AddHours(-windowHours);

        var stopAll = await _settings.GetBoolAsync(SystemSettingKeys.StopAllServerRuns, false, ct);

        var dbReachable = false;
        var pingMs = 0.0;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            dbReachable = await _db.Database.CanConnectAsync(ct);
            if (dbReachable) _ = await _db.Users.AsNoTracking().Select(u => u.Id).FirstOrDefaultAsync(ct);
        }
        catch { dbReachable = false; }
        sw.Stop();
        pingMs = sw.Elapsed.TotalMilliseconds;

        var liveSessions = playingSessionUserIds.Count;

        // Runs per user, not a set of users: the table shows how many processes each account is
        // running ("how much of this box is that one person using"), while LiveSessions above stays the
        // count of runs. Two accounts running one process each and one account running two look very
        // different to an operator, and collapsing both to a boolean would hide that.
        var runsByUser = playingSessionUserIds
            .Where(id => id is > 0)
            .GroupBy(id => id!.Value)
            .ToDictionary(g => g.Key, g => g.Count());

        // Runs started with no identity at all. They are counted by LiveSessions like any other run —
        // a client can start one without a token, and the dashboard's own figures have to add up — but
        // there is no account to hang them on, so they are shown on the anonymous row.
        var unidentifiedRuns = playingSessionUserIds.Count(id => id is null or <= 0);

        if (!dbReachable)
        {
            // Still answer with what is known in memory: the operator opened this page because
            // something is wrong, and "database unreachable" is part of the answer.
            return new MonitoringSnapshot
            {
                CapturedAtUtc = now,
                DatabaseReachable = false,
                DatabasePingMs = Math.Round(pingMs, 2),
                NetworkReceivedBytes = TrafficMeter.BytesIn,
                NetworkSentBytes = TrafficMeter.BytesOut,
                LiveSessions = liveSessions,
                WindowHours = windowHours,
                StopAllServerRuns = stopAll
            };
        }

        var samples = await ReadSamplesAsync(since, ct);
        var (inPerSec, outPerSec) = ComputeRates(samples);
        var history = BuildHistory(samples, since, now);

        var userTraffic = await ReadTrafficAsync(TrafficScope.User, since, ct);
        var ipTraffic = await ReadTrafficAsync(TrafficScope.Ip, since, ct);
        var presence = await ReadPresenceAsync(since, ct);
        var names = await ReadUserNamesAsync(userTraffic.Keys, presence, ct);

        var byUser = BuildUserSlices(userTraffic, presence, names, runsByUser, unidentifiedRuns, now);
        var byIp = BuildIpSlices(ipTraffic, presence);

        return new MonitoringSnapshot
        {
            CapturedAtUtc = now,
            DatabaseReachable = true,
            DatabasePingMs = Math.Round(pingMs, 2),
            // The live meter, not the newest stored sample: these two are labelled "since this
            // application started", and the stored series is a minute behind at best — and would
            // answer with a PREVIOUS process's totals in the first minute after a restart.
            NetworkReceivedBytes = TrafficMeter.BytesIn,
            NetworkSentBytes = TrafficMeter.BytesOut,
            NetworkInPerSec = inPerSec,
            NetworkOutPerSec = outPerSec,
            WindowBytesIn = history.Sum(p => p.BytesIn),
            WindowBytesOut = history.Sum(p => p.BytesOut),
            LiveSessions = liveSessions,
            OnlineUsers = byUser.Count(u => u.IsOnline && !u.IsAnonymous),
            DistinctIpCount = byIp.Count,
            WindowHours = windowHours,
            StopAllServerRuns = stopAll,
            History = history,
            ByUser = byUser,
            ByIp = byIp
        };
    }

    // ---- Stored series --------------------------------------------------------------------------

    private async Task<List<ServerMetricsSample>> ReadSamplesAsync(DateTime since, CancellationToken ct) =>
        await _db.ServerMetricsSamples.AsNoTracking()
            .Where(s => s.CapturedAtUtc >= since)
            .OrderBy(s => s.CapturedAtUtc)
            .Select(s => new ServerMetricsSample
            {
                CapturedAtUtc = s.CapturedAtUtc,
                NetworkReceivedBytes = s.NetworkReceivedBytes,
                NetworkSentBytes = s.NetworkSentBytes,
                LiveSessions = s.LiveSessions,
                OnlineUsers = s.OnlineUsers
            })
            .ToListAsync(ct);

    /// <summary>
    /// Bytes per second, from the two newest stored samples.
    /// </summary>
    /// <remarks>
    /// Sampling twice inside one request would make the page take as long as the sampling interval to
    /// answer, so the rate is computed from history. A counter that went BACKWARDS means the process
    /// restarted and its counters restarted with it; that is reported as zero rather than as a
    /// negative rate.
    /// </remarks>
    private static (long In, long Out) ComputeRates(List<ServerMetricsSample> samples)
    {
        if (samples.Count < 2) return (0, 0);
        var last = samples[^1];
        var previous = samples[^2];
        var seconds = (last.CapturedAtUtc - previous.CapturedAtUtc).TotalSeconds;
        if (seconds <= 0.5) return (0, 0);

        var inDelta = Math.Max(0, last.NetworkReceivedBytes - previous.NetworkReceivedBytes);
        var outDelta = Math.Max(0, last.NetworkSentBytes - previous.NetworkSentBytes);
        return ((long)(inDelta / seconds), (long)(outDelta / seconds));
    }

    /// <summary>Collapse the stored series into a fixed number of chart buckets.</summary>
    private static List<MonitoringPoint> BuildHistory(List<ServerMetricsSample> samples, DateTime since, DateTime now)
    {
        if (samples.Count == 0) return new List<MonitoringPoint>();

        var spanSeconds = Math.Max(60, (now - since).TotalSeconds);
        var bucketSeconds = Math.Max(60, spanSeconds / ChartBuckets);

        var bytesIn = new long[ChartBuckets];
        var bytesOut = new long[ChartBuckets];
        var online = new int[ChartBuckets];
        var live = new int[ChartBuckets];

        ServerMetricsSample? previous = null;
        foreach (var sample in samples)
        {
            long deltaIn = 0, deltaOut = 0;
            if (previous is not null)
            {
                // The stored figures are cumulative counters, so each sample CONTRIBUTES the difference
                // from the reading before it. A negative difference is a restart and contributes zero.
                deltaIn = Math.Max(0, sample.NetworkReceivedBytes - previous.NetworkReceivedBytes);
                deltaOut = Math.Max(0, sample.NetworkSentBytes - previous.NetworkSentBytes);
            }
            previous = sample;

            var index = (int)((sample.CapturedAtUtc - since).TotalSeconds / bucketSeconds);
            index = Math.Clamp(index, 0, ChartBuckets - 1);
            bytesIn[index] += deltaIn;
            bytesOut[index] += deltaOut;
            online[index] = Math.Max(online[index], sample.OnlineUsers);
            live[index] = Math.Max(live[index], sample.LiveSessions);
        }

        var points = new List<MonitoringPoint>(ChartBuckets);
        for (var i = 0; i < ChartBuckets; i++)
        {
            points.Add(new MonitoringPoint
            {
                // Every bucket is emitted, including the empty ones: a quiet hour has to read as a gap
                // in the chart, not as a shorter axis with the quiet time silently removed.
                AtUtc = since.AddSeconds((i + 1) * bucketSeconds),
                BytesIn = bytesIn[i],
                BytesOut = bytesOut[i],
                OnlineUsers = online[i],
                LiveSessions = live[i]
            });
        }
        return points;
    }

    private async Task<Dictionary<string, (long In, long Out)>> ReadTrafficAsync(
        TrafficScope scope, DateTime since, CancellationToken ct)
    {
        var rows = await _db.TrafficUsageSamples.AsNoTracking()
            .Where(s => s.Scope == scope && s.CapturedAtUtc >= since)
            .GroupBy(s => s.Key)
            .Select(g => new { Key = g.Key, In = g.Sum(x => x.BytesIn), Out = g.Sum(x => x.BytesOut) })
            .ToListAsync(ct);

        return rows.ToDictionary(r => r.Key, r => (r.In, r.Out), StringComparer.Ordinal);
    }

    private sealed record PresenceRow(int UserId, string? Ip, DateTime LastSeenUtc, string? UserName);

    /// <summary>Devices seen in the window, with the account each one belongs to.</summary>
    private async Task<List<PresenceRow>> ReadPresenceAsync(DateTime since, CancellationToken ct)
    {
        var rows = await _db.DeviceSessions.AsNoTracking()
            .Where(d => d.LastSeenUtc >= since)
            .Select(d => new { d.UserId, d.IpAddress, d.LastSeenUtc, d.User.UserName })
            .ToListAsync(ct);

        return rows.Select(r => new PresenceRow(r.UserId, r.IpAddress, r.LastSeenUtc, r.UserName)).ToList();
    }

    /// <summary>Names for every account that has traffic or presence in the window.</summary>
    private async Task<Dictionary<int, string>> ReadUserNamesAsync(
        IEnumerable<string> trafficKeys, List<PresenceRow> presence, CancellationToken ct)
    {
        var ids = new HashSet<int>();
        foreach (var key in trafficKeys)
        {
            if (int.TryParse(key, out var id) && id > 0) ids.Add(id);
        }
        foreach (var row in presence) ids.Add(row.UserId);
        if (ids.Count == 0) return new Dictionary<int, string>();

        var list = ids.ToList();
        var users = await _db.Users.AsNoTracking()
            .Where(u => list.Contains(u.Id))
            .Select(u => new { u.Id, u.UserName })
            .ToListAsync(ct);

        return users.ToDictionary(u => u.Id, u => u.UserName);
    }

    private static List<MonitoringUserSlice> BuildUserSlices(
        Dictionary<string, (long In, long Out)> traffic,
        List<PresenceRow> presence,
        Dictionary<int, string> names,
        IReadOnlyDictionary<int, int> runsByUser,
        int unidentifiedRuns,
        DateTime now)
    {
        var playingUsers = runsByUser.Keys.ToHashSet();
        var slices = new List<MonitoringUserSlice>();
        var anonymous = traffic.TryGetValue("anon", out var anonTraffic);

        foreach (var (key, bytes) in traffic)
        {
            if (!int.TryParse(key, out var userId) || userId <= 0) continue;

            var mine = presence.Where(p => p.UserId == userId).ToList();
            var playing = playingUsers.Contains(userId);
            var lastSeen = mine.Count > 0 ? mine.Max(p => p.LastSeenUtc) : (DateTime?)null;
            slices.Add(new MonitoringUserSlice
            {
                UserId = userId,
                UserName = names.TryGetValue(userId, out var name) ? name : userId.ToString(),
                Ips = string.Join(", ", mine.Select(p => p.Ip).Where(ip => !string.IsNullOrWhiteSpace(ip)).Distinct()),
                BytesIn = bytes.In,
                BytesOut = bytes.Out,
                ActiveRuns = RunsPer(runsByUser, userId),
                LastSeenUtc = lastSeen,
                IsOnline = EventLogService.IsOnline(lastSeen, playing, now)
            });
        }

        // A connected user who has not yet produced traffic in the window (or who is running a process
        // right now) still belongs in the table: it is the ACTIONS on those rows that matter, and a
        // missing row would hide the very session an operator wants to close.
        foreach (var group in presence.GroupBy(p => p.UserId))
        {
            if (traffic.ContainsKey(group.Key.ToString())) continue;
            var playing = playingUsers.Contains(group.Key);
            var lastSeen = group.Max(p => p.LastSeenUtc);
            slices.Add(new MonitoringUserSlice
            {
                UserId = group.Key,
                UserName = names.TryGetValue(group.Key, out var name) ? name : group.Key.ToString(),
                Ips = string.Join(", ", group.Select(p => p.Ip).Where(ip => !string.IsNullOrWhiteSpace(ip)).Distinct()),
                BytesIn = 0,
                BytesOut = 0,
                ActiveRuns = RunsPer(runsByUser, group.Key),
                LastSeenUtc = lastSeen,
                IsOnline = EventLogService.IsOnline(lastSeen, playing, now)
            });
        }

        foreach (var userId in playingUsers)
        {
            if (slices.Any(s => s.UserId == userId)) continue;
            slices.Add(new MonitoringUserSlice
            {
                UserId = userId,
                UserName = names.TryGetValue(userId, out var name) ? name : userId.ToString(),
                Ips = "",
                BytesIn = 0,
                BytesOut = 0,
                ActiveRuns = RunsPer(runsByUser, userId),
                LastSeenUtc = null,
                IsOnline = true
            });
        }

        // The anonymous row exists for either reason: traffic nobody signed for, or runs nobody signed
        // for. Showing one without the other would make the header's run count unfindable in the table.
        if (anonymous || unidentifiedRuns > 0)
        {
            slices.Add(new MonitoringUserSlice
            {
                UserId = 0,
                UserName = "",
                Ips = "",
                BytesIn = anonTraffic.In,
                BytesOut = anonTraffic.Out,
                ActiveRuns = unidentifiedRuns,
                LastSeenUtc = null,
                IsOnline = unidentifiedRuns > 0
            });
        }

        // Busiest first: the dashboard is opened to find out who is generating traffic, and the answer
        // has to be the first row rather than a row to be hunted for.
        return slices
            .OrderByDescending(s => s.BytesTotal)
            .ThenByDescending(s => s.IsOnline)
            .ThenBy(s => s.UserId)
            .ToList();
    }

    /// <summary>How many server-side runs this user is holding right now (0 for everybody else).</summary>
    private static int RunsPer(IReadOnlyDictionary<int, int> runsByUser, int userId) =>
        runsByUser.TryGetValue(userId, out var runs) ? runs : 0;

    private static List<MonitoringIpSlice> BuildIpSlices(
        Dictionary<string, (long In, long Out)> traffic,
        List<PresenceRow> presence)
    {
        var slices = new List<MonitoringIpSlice>();

        foreach (var (key, bytes) in traffic)
        {
            if (string.Equals(key, "unknown", StringComparison.OrdinalIgnoreCase)) continue;
            var users = presence.Where(p => string.Equals(p.Ip, key, StringComparison.OrdinalIgnoreCase))
                .Select(p => p.UserId).Distinct().Count();
            slices.Add(new MonitoringIpSlice
            {
                Ip = key,
                BytesIn = bytes.In,
                BytesOut = bytes.Out,
                Users = users,
                LastSeenUtc = presence.Where(p => string.Equals(p.Ip, key, StringComparison.OrdinalIgnoreCase))
                    .Select(p => (DateTime?)p.LastSeenUtc).Max()
            });
        }

        return slices.OrderByDescending(s => s.BytesTotal).ToList();
    }
}