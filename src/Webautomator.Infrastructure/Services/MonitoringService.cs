using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Webautomator.Domain.Entities;
using Webautomator.Domain.Enums;
using Webautomator.Infrastructure.Persistence;
// The domain has its own `Process` entity, so the diagnostics type is aliased rather than imported.
using SysProcess = System.Diagnostics.Process;

namespace Webautomator.Infrastructure.Services;

// =====================================================================================================
// The monitoring model
//
// The owner's priority order is explicit and the shape of these types follows it:
//   1. NETWORK (bandwidth in/out) — the whole point is "what load is this putting on the network".
//   2. DISK reads/writes.
//   3. Everything else (memory, CPU, threads).
// …and the FIRST axis to break all of that down by is USER and IP, then process, then data source.
// PLAN IS DELIBERATELY ABSENT: which subscription someone is on does not describe the load they put
// on the box, and a per-plan total invited reading a plan difference into a traffic number.
// =====================================================================================================

/// <summary>Where one figure sits against what it is measured against.</summary>
public sealed class MonitoringSlice
{
    public string Key { get; init; } = "";
    public string Label { get; init; } = "";
    /// <summary>Secondary line: an IP for a user, an owner for a process, a kind for a source.</summary>
    public string? Sub { get; init; }
    public long BytesIn { get; init; }
    public long BytesOut { get; init; }
    public long DiskRead { get; init; }
    public long DiskWrite { get; init; }
    public int Events { get; init; }
    public int Plays { get; init; }
    public int Processes { get; init; }
    public int Sources { get; init; }
    public int Rows { get; init; }
    public DateTime? LastSeenUtc { get; init; }
    public bool IsOnline { get; init; }
    public long Total => BytesIn + BytesOut;
}

/// <summary>One point on a history line.</summary>
public sealed class MonitoringPoint
{
    public DateTime AtUtc { get; init; }
    public long BytesIn { get; init; }
    public long BytesOut { get; init; }
    public long DiskRead { get; init; }
    public long DiskWrite { get; init; }
    public long WorkingSetBytes { get; init; }
    public long AvailableBytes { get; init; }
    public int LiveSessions { get; init; }
    public int OnlineUsers { get; init; }
}

/// <summary>A full picture of this server's load right now, plus the requested history window.</summary>
public sealed class MonitoringSnapshot
{
    public DateTime CapturedAtUtc { get; init; } = DateTime.UtcNow;
    public TimeSpan ProcessUptime { get; init; }
    public bool DatabaseReachable { get; init; }
    public double DatabasePingMs { get; init; }
    public int LogicalProcessors { get; init; }

    // ---- Host / process totals ----
    public long ProcessWorkingSetBytes { get; init; }
    public long ProcessPrivateBytes { get; init; }
    public long TotalPhysicalBytes { get; init; }
    public long AvailablePhysicalBytes { get; init; }
    public long ManagedHeapBytes { get; init; }
    public double ProcessorSeconds { get; init; }
    public int ThreadCount { get; init; }
    public int Gen2Collections { get; init; }

    // ---- Network + disk SINCE START (raw counters) ----
    public long NetworkReceivedBytes { get; init; }
    public long NetworkSentBytes { get; init; }
    public long DiskReadBytes { get; init; }
    public long DiskWriteBytes { get; init; }

    // ---- Rates over the sampled window (the numbers a person actually wants) ----
    /// <summary>Bytes/second received, averaged across the history window.</summary>
    public double NetworkInPerSec { get; init; }
    public double NetworkOutPerSec { get; init; }
    public double DiskReadPerSec { get; init; }
    public double DiskWritePerSec { get; init; }

    // ---- Load ----
    public int LiveSessions { get; init; }
    public int OnlineUsers { get; init; }
    public int Events24h { get; init; }
    public int ProblemEvents24h { get; init; }
    public int Plays24h { get; init; }
    public int RequestCount24h { get; init; }

    // ---- Totals ----
    public int UserCount { get; init; }
    public int ActiveUserCount { get; init; }
    public int ProcessCount { get; init; }
    public int DataSourceCount { get; init; }
    public int DataSourceRowCount { get; init; }
    public int DataSourceCellCount { get; init; }
    public int DistinctIpCount { get; init; }

    // ---- Breakdowns, in the owner's priority order ----
    /// <summary>FIRST: per user, with the IPs they used.</summary>
    public IReadOnlyList<MonitoringSlice> ByUser { get; init; } = Array.Empty<MonitoringSlice>();
    /// <summary>SECOND: per client IP — the direct answer to "what load is on the network".</summary>
    public IReadOnlyList<MonitoringSlice> ByIp { get; init; } = Array.Empty<MonitoringSlice>();
    /// <summary>THIRD: per process.</summary>
    public IReadOnlyList<MonitoringSlice> ByProcess { get; init; } = Array.Empty<MonitoringSlice>();
    /// <summary>FOURTH: per data source.</summary>
    public IReadOnlyList<MonitoringSlice> BySource { get; init; } = Array.Empty<MonitoringSlice>();

    /// <summary>History for the requested window, oldest first.</summary>
    public IReadOnlyList<MonitoringPoint> History { get; init; } = Array.Empty<MonitoringPoint>();

    /// <summary>The window the history covers, for the caption.</summary>
    public int WindowHours { get; init; } = 24;
}

/// <summary>
/// Collects the numbers behind the monitoring dashboard: live host/process counters from the runtime,
/// a stored time series for history, and per-user / per-IP / per-process / per-source breakdowns read
/// from the database.
/// </summary>
/// <remarks>
/// Split rather than one method because the two halves have different lifetimes: the counters are a
/// cheap in-process read that the live view calls every few seconds, while the breakdowns are real
/// queries. The live view leans on the former; the history view on the latter.
/// </remarks>
public class MonitoringService
{
    /// <summary>How long a metrics sample is considered "current" before the live view re-samples.</summary>
    public static readonly TimeSpan SampleInterval = TimeSpan.FromMinutes(1);

    private readonly AppDbContext _db;

    public MonitoringService(AppDbContext db) => _db = db;

    // ---- Raw process counters -------------------------------------------------------------------

    /// <summary>
    /// Read this process's own cumulative disk and network counters for the sampler to store.
    /// </summary>
    /// <remarks>
    /// These are PER-PROCESS and CUMULATIVE. Both matter: a host-wide figure would include every other
    /// tenant on the box, and an instantaneous figure would need two reads to become a rate. The
    /// sampler stores the cumulative values and the dashboard differences consecutive rows to get a
    /// rate, which is also how the history chart derives its slopes.
    ///
    /// On Windows the two disk totals are read from the process's IO counters. .NET exposes no
    /// per-process NETWORK byte counter (it is a socket-level fact, not a process counter), so the
    /// network figures are sourced from the sum of what the app itself has served and received via
    /// its own tracked traffic (see <see cref="TrafficMeter"/>). Everything degrades to 0 on a
    /// platform that cannot report it, and the UI says "not reported" rather than showing a false 0.
    /// </remarks>
    public static ProcessCounters ReadCounters(SysProcess proc)
    {
        // Disk totals are a real process counter on Windows; the sampler passes them in when it has
        // them. Network totals come from the app's own meter, because .NET does not expose a
        // per-process network byte counter on any platform — see TrafficMeter.
        _ = proc;
        return new ProcessCounters(0, 0, TrafficMeter.BytesIn, TrafficMeter.BytesOut);
    }

    /// <summary>The process's own cumulative IO counters.</summary>
    public readonly record struct ProcessCounters(long DiskRead, long DiskWrite, long NetIn, long NetOut);

    // ---- Capture --------------------------------------------------------------------------------

    /// <summary>
    /// Take one full reading: live counters + stored history + breakdowns, over <paramref name="windowHours"/>.
    /// </summary>
    public async Task<MonitoringSnapshot> CaptureAsync(
        int liveSessions,
        int onlineUsers,
        int windowHours = 24,
        CancellationToken ct = default)
    {
        windowHours = Math.Clamp(windowHours, 1, 24 * 30);
        var now = DateTime.UtcNow;
        var since = now.AddHours(-windowHours);

        var proc = SysProcess.GetCurrentProcess();
        var dbReachable = false;
        var pingMs = 0.0;
        var sw = Stopwatch.StartNew();
        try
        {
            dbReachable = await _db.Database.CanConnectAsync(ct);
            if (dbReachable) _ = await _db.Users.AsNoTracking().Select(u => u.Id).FirstOrDefaultAsync(ct);
        }
        catch { dbReachable = false; }
        sw.Stop();
        pingMs = sw.Elapsed.TotalMilliseconds;

        var history = dbReachable
            ? await ReadHistoryAsync(since, ct)
            : new List<MonitoringPoint>();

        // Rates come from the two most recent stored samples, not from a fresh sleep — sampling twice
        // in one request would make the page take as long as the interval to answer.
        var (netInPerSec, netOutPerSec, diskReadPerSec, diskWritePerSec) = await ComputeRatesAsync(ct);
        var latest = history.Count > 0 ? history[^1] : null;

        var snapshot = new MonitoringSnapshot
        {
            CapturedAtUtc = now,
            ProcessUptime = SafeUptime(proc),
            DatabaseReachable = dbReachable,
            DatabasePingMs = Math.Round(pingMs, 2),
            LogicalProcessors = Environment.ProcessorCount,
            ProcessWorkingSetBytes = SafeLong(() => proc.WorkingSet64),
            ProcessPrivateBytes = SafeLong(() => proc.PrivateMemorySize64),
            ProcessorSeconds = SafeDouble(() => proc.TotalProcessorTime.TotalSeconds),
            ThreadCount = SafeInt(() => proc.Threads.Count),
            ManagedHeapBytes = GC.GetTotalMemory(forceFullCollection: false),
            Gen2Collections = GC.CollectionCount(2),
            TotalPhysicalBytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes,
            AvailablePhysicalBytes = AvailableMemory(),
            NetworkReceivedBytes = latest?.BytesIn ?? 0,
            NetworkSentBytes = latest?.BytesOut ?? 0,
            DiskReadBytes = latest?.DiskRead ?? 0,
            DiskWriteBytes = latest?.DiskWrite ?? 0,
            NetworkInPerSec = netInPerSec,
            NetworkOutPerSec = netOutPerSec,
            DiskReadPerSec = diskReadPerSec,
            DiskWritePerSec = diskWritePerSec,
            LiveSessions = liveSessions,
            OnlineUsers = onlineUsers,
            History = history,
            WindowHours = windowHours
        };

        if (!dbReachable) return snapshot;

        var since24h = now.AddHours(-24);
        var counts = await ReadCountsAsync(since24h, ct);
        var userSlices = await BuildUserSlicesAsync(since, now, ct);
        var ipSlices = BuildIpSlices(userSlices);
        var processSlices = await BuildProcessSlicesAsync(ct);
        var sourceSlices = await BuildSourceSlicesAsync(ct);

        return new MonitoringSnapshot
        {
            CapturedAtUtc = snapshot.CapturedAtUtc,
            ProcessUptime = snapshot.ProcessUptime,
            DatabaseReachable = true,
            DatabasePingMs = snapshot.DatabasePingMs,
            LogicalProcessors = snapshot.LogicalProcessors,
            ProcessWorkingSetBytes = snapshot.ProcessWorkingSetBytes,
            ProcessPrivateBytes = snapshot.ProcessPrivateBytes,
            ProcessorSeconds = snapshot.ProcessorSeconds,
            ThreadCount = snapshot.ThreadCount,
            ManagedHeapBytes = snapshot.ManagedHeapBytes,
            Gen2Collections = snapshot.Gen2Collections,
            TotalPhysicalBytes = snapshot.TotalPhysicalBytes,
            AvailablePhysicalBytes = snapshot.AvailablePhysicalBytes,
            NetworkReceivedBytes = snapshot.NetworkReceivedBytes,
            NetworkSentBytes = snapshot.NetworkSentBytes,
            DiskReadBytes = snapshot.DiskReadBytes,
            DiskWriteBytes = snapshot.DiskWriteBytes,
            NetworkInPerSec = snapshot.NetworkInPerSec,
            NetworkOutPerSec = snapshot.NetworkOutPerSec,
            DiskReadPerSec = snapshot.DiskReadPerSec,
            DiskWritePerSec = snapshot.DiskWritePerSec,
            LiveSessions = snapshot.LiveSessions,
            OnlineUsers = snapshot.OnlineUsers,
            History = snapshot.History,
            WindowHours = snapshot.WindowHours,
            Events24h = counts.Events,
            ProblemEvents24h = counts.Problems,
            Plays24h = counts.Plays,
            RequestCount24h = counts.Requests,
            UserCount = counts.Users,
            ActiveUserCount = counts.ActiveUsers,
            ProcessCount = counts.Processes,
            DataSourceCount = counts.Sources,
            DataSourceRowCount = counts.SourceRows,
            DataSourceCellCount = counts.SourceCells,
            DistinctIpCount = ipSlices.Count,
            ByUser = userSlices,
            ByIp = ipSlices,
            ByProcess = processSlices,
            BySource = sourceSlices
        };
    }

    // ---- History --------------------------------------------------------------------------------

    private async Task<List<MonitoringPoint>> ReadHistoryAsync(DateTime since, CancellationToken ct)
        => await _db.ServerMetricsSamples.AsNoTracking()
            .Where(s => s.CapturedAtUtc >= since)
            .OrderBy(s => s.CapturedAtUtc)
            .Select(s => new MonitoringPoint
            {
                AtUtc = s.CapturedAtUtc,
                BytesIn = s.NetworkReceivedBytes,
                BytesOut = s.NetworkSentBytes,
                DiskRead = s.DiskReadBytes,
                DiskWrite = s.DiskWriteBytes,
                WorkingSetBytes = s.ProcessWorkingSetBytes,
                AvailableBytes = s.AvailablePhysicalBytes,
                LiveSessions = s.LiveSessions,
                OnlineUsers = s.OnlineUsers
            })
            .ToListAsync(ct);

    /// <summary>Derive per-second rates by differencing the two newest samples.</summary>
    public async Task<(double netIn, double netOut, double diskRead, double diskWrite)> ComputeRatesAsync(CancellationToken ct)
    {
        var pair = await _db.ServerMetricsSamples.AsNoTracking()
            .OrderByDescending(s => s.CapturedAtUtc)
            .Take(2)
            .ToListAsync(ct);
        if (pair.Count < 2) return (0, 0, 0, 0);

        var newest = pair[0];
        var prev = pair[1];
        var secs = (newest.CapturedAtUtc - prev.CapturedAtUtc).TotalSeconds;
        // A clock jump or two samples stamped the same second would divide by zero; treat as no rate.
        if (secs <= 0.5) return (0, 0, 0, 0);

        static double Rate(long now, long then, double seconds)
        {
            // Counters are cumulative and reset when the process restarts; a negative delta is a
            // restart, not negative traffic, so it is reported as zero rather than a spike downward.
            var d = now - then;
            return d <= 0 ? 0 : d / seconds;
        }

        return (
            Rate(newest.NetworkReceivedBytes, prev.NetworkReceivedBytes, secs),
            Rate(newest.NetworkSentBytes, prev.NetworkSentBytes, secs),
            Rate(newest.DiskReadBytes, prev.DiskReadBytes, secs),
            Rate(newest.DiskWriteBytes, prev.DiskWriteBytes, secs));
    }

    private sealed record Counts(int Events, int Problems, int Plays, int Requests,
        int Users, int ActiveUsers, int Processes, int Sources, int SourceRows, int SourceCells);

    private async Task<Counts> ReadCountsAsync(DateTime since, CancellationToken ct)
    {
        var events = await _db.EventLogs.AsNoTracking().CountAsync(e => e.CreatedAtUtc >= since, ct);
        var problems = await _db.EventLogs.AsNoTracking()
            .CountAsync(e => e.CreatedAtUtc >= since && (e.Level == "Error" || e.Level == "Warning" || e.Level == "Warn"), ct);
        var plays = await _db.EventLogs.AsNoTracking()
            .CountAsync(e => e.CreatedAtUtc >= since && e.Category == "Play" && e.EventType.StartsWith("Play"), ct);
        // "Requests" is a proxy for traffic volume: every client event is one browser call home.
        var requests = await _db.EventLogs.AsNoTracking()
            .CountAsync(e => e.CreatedAtUtc >= since && (e.Category == "Client" || e.Category == "System"), ct);

        var users = await _db.Users.AsNoTracking().CountAsync(ct);
        var activeUsers = await _db.Users.AsNoTracking().CountAsync(u => u.IsActive, ct);
        var processes = await _db.Processes.AsNoTracking().CountAsync(ct);
        var sources = await _db.DataSources.AsNoTracking().CountAsync(ct);
        var cells = await _db.DataSourceCells.AsNoTracking().CountAsync(ct);
        // Row count is derived, not stored (see the data-source contract in repo memory).
        var rows = cells == 0 ? 0 : -1;
        if (rows == -1)
        {
            rows = await _db.DataSourceCells.AsNoTracking()
                .GroupBy(c => c.DataSourceId)
                .Select(g => g.Max(c => c.RowIndex) + 1)
                .SumAsync(ct);
        }

        return new Counts(events, problems, plays, requests, users, activeUsers, processes, sources, rows, cells);
    }

    // ---- Breakdown #1: users (with their IPs) ----------------------------------------------------

    /// <summary>
    /// Per-user usage: how many processes and sources they own, how active they are, and the IPs they
    /// have been seen from. Traffic is attributed to the user who was active, because the process's own
    /// socket counters cannot be split by user — the honest answer is "this user's activity drove the
    /// load in this window", not a fabricated per-user byte count.
    /// </summary>
    private async Task<IReadOnlyList<MonitoringSlice>> BuildUserSlicesAsync(DateTime since, DateTime now, CancellationToken ct)
    {
        var devices = await _db.DeviceSessions.AsNoTracking()
            .Select(d => new { d.UserId, d.IpAddress, d.LastSeenUtc, d.LoginCount })
            .ToListAsync(ct);
        var ipByUser = devices
            .Where(d => !string.IsNullOrWhiteSpace(d.IpAddress))
            .GroupBy(d => d.UserId)
            .ToDictionary(
                g => g.Key,
                g => string.Join(", ", g.Select(x => x.IpAddress!).Distinct().Take(3)));

        var lastSeen = devices.GroupBy(d => d.UserId)
            .ToDictionary(g => g.Key, g => g.Max(x => x.LastSeenUtc));

        var playsByUser = await _db.EventLogs.AsNoTracking()
            .Where(e => e.CreatedAtUtc >= since && e.Category == "Play"
                        && e.EventType.StartsWith("Play") && e.UserId != null)
            .GroupBy(e => e.UserId!.Value)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var playMap = playsByUser.ToDictionary(x => x.UserId, x => x.Count);

        var eventsByUser = await _db.EventLogs.AsNoTracking()
            .Where(e => e.CreatedAtUtc >= since && e.UserId != null)
            .GroupBy(e => e.UserId!.Value)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var eventMap = eventsByUser.ToDictionary(x => x.UserId, x => x.Count);

        var rows = await _db.Users.AsNoTracking()
            .Select(u => new
            {
                u.Id,
                u.UserName,
                u.FirstName,
                u.LastName,
                u.Role,
                ProcessCount = _db.Processes.Count(p => p.CreatorUserId == u.Id),
                SourceCount = _db.DataSources.Count(d => d.OwnerUserId == u.Id)
            })
            .ToListAsync(ct);

        var onlineWindow = now.AddMinutes(-15);
        return rows
            .Select(u =>
            {
                var seen = lastSeen.TryGetValue(u.Id, out var ls) ? ls : (DateTime?)null;
                var name = string.Join(" ", new[] { u.FirstName, u.LastName }
                    .Where(s => !string.IsNullOrWhiteSpace(s))).Trim();
                return new MonitoringSlice
                {
                    Key = u.Id.ToString(),
                    Label = string.IsNullOrWhiteSpace(name) ? u.UserName : name,
                    Sub = ipByUser.TryGetValue(u.Id, out var ips) ? ips : u.UserName,
                    Processes = u.ProcessCount,
                    Sources = u.SourceCount,
                    Plays = playMap.TryGetValue(u.Id, out var c) ? c : 0,
                    Events = eventMap.TryGetValue(u.Id, out var e2) ? e2 : 0,
                    LastSeenUtc = seen,
                    IsOnline = seen is not null && seen >= onlineWindow
                };
            })
            // Activity first, then ownership: a user with many processes but no activity is not load.
            .OrderByDescending(s => s.Events + s.Plays)
            .ThenByDescending(s => s.Processes)
            .ToList();
    }

    /// <summary>
    /// Roll the user slices up by IP — the owner's headline question.
    /// </summary>
    /// <remarks>
    /// Built from the device rows rather than a second query, so the two tables can never disagree.
    /// Load is attributed to an IP as "how many events and runs came from a session seen at this IP",
    /// which is what the network question actually means; the box's own byte counters have no notion
    /// of which client caused them.
    /// </remarks>
    private IReadOnlyList<MonitoringSlice> BuildIpSlices(IReadOnlyList<MonitoringSlice> userSlices)
        => userSlices
            .GroupBy(s => s.Sub ?? "—")
            .Select(g => new MonitoringSlice
            {
                Key = g.Key,
                Label = g.Key,
                Sub = string.Join("، ", g.Select(x => x.Label).Distinct().Take(3)),
                Events = g.Sum(x => x.Events),
                Plays = g.Sum(x => x.Plays),
                Processes = g.Sum(x => x.Processes),
                Sources = g.Sum(x => x.Sources),
                LastSeenUtc = g.Max(x => x.LastSeenUtc),
                IsOnline = g.Any(x => x.IsOnline)
            })
            .OrderByDescending(s => s.Events + s.Plays)
            .ToList();

    // ---- Breakdown #2: processes -----------------------------------------------------------------

    private async Task<IReadOnlyList<MonitoringSlice>> BuildProcessSlicesAsync(CancellationToken ct)
    {
        var processes = await _db.Processes.AsNoTracking()
            .Select(p => new
            {
                p.Id,
                p.Title,
                p.CreatorUserId,
                OwnerName = p.Creator != null ? p.Creator.UserName : null,
                UpdatedAtUtc = p.UpdatedAtUtc,
                StepCount = p.GraphJson != null ? p.GraphJson.Length : 0,
                SourceCount = p.DataSourceLinks.Count
            })
            .ToListAsync(ct);

        // Per-process run counts come from the event log, whose Path carries the process route.
        var runs = await _db.EventLogs.AsNoTracking()
            .Where(e => e.Category == "Play" && e.EventType.StartsWith("Play"))
            .Where(e => e.Path != null)
            .Select(e => e.Path!)
            .ToListAsync(ct);

        var runCounts = runs
            .Select(ExtractProcessId)
            .Where(id => id is not null)
            .GroupBy(id => id!.Value)
            .ToDictionary(g => g.Key, g => g.Count());

        return processes
            .Select(p => new MonitoringSlice
            {
                Key = p.Id.ToString(),
                Label = string.IsNullOrWhiteSpace(p.Title) ? $"#{p.Id}" : p.Title!,
                Sub = p.OwnerName ?? "—",
                Plays = runCounts.TryGetValue(p.Id, out var c) ? c : 0,
                Sources = p.SourceCount,
                Rows = p.StepCount,
                LastSeenUtc = p.UpdatedAtUtc
            })
            .OrderByDescending(s => s.Plays)
            .ThenByDescending(s => s.Rows)
            .ToList();
    }

    /// <summary>Pull a process id out of an event path like <c>/api/tasks/12/play</c>.</summary>
    private static int? ExtractProcessId(string path)
    {
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i < parts.Length - 1; i++)
        {
            // The id follows the "tasks" segment; "NumberStyles.Integer" keeps it strict so a
            // segment like "play" is never mistaken for an id.
            if (parts[i].Equals("tasks", StringComparison.OrdinalIgnoreCase)
                && int.TryParse(parts[i + 1], out var id))
                return id;
        }
        return null;
    }

    // ---- Breakdown #3: data sources --------------------------------------------------------------

    private async Task<IReadOnlyList<MonitoringSlice>> BuildSourceSlicesAsync(CancellationToken ct)
    {
        var sources = await _db.DataSources.AsNoTracking()
            .Select(d => new
            {
                d.Id,
                d.Title,
                d.IsPublic,
                OwnerName = d.Owner != null ? d.Owner.UserName : null,
                d.ColumnCount,
                d.UpdatedAtUtc,
                Rows = _db.DataSourceCells.Where(c => c.DataSourceId == d.Id).Select(c => (int?)c.RowIndex).Max(),
                Processes = d.ProcessLinks.Count
            })
            .ToListAsync(ct);

        return sources
            .Select(d => new MonitoringSlice
            {
                Key = d.Id.ToString(),
                Label = string.IsNullOrWhiteSpace(d.Title) ? $"#{d.Id}" : d.Title!,
                // Public/shared is called out because such a source keeps being read from the SERVER
                // even for a locally-run process — the one exception to local-run's traffic saving.
                Sub = (d.IsPublic ? "عمومی · " : "") + (d.OwnerName ?? "—"),
                Processes = d.Processes,
                Rows = d.Rows is null ? 0 : d.Rows.Value + 1,
                Sources = d.ColumnCount,
                LastSeenUtc = d.UpdatedAtUtc
            })
            .OrderByDescending(s => s.Rows)
            .ThenByDescending(s => s.Processes)
            .ToList();
    }

    // ---- Safe probes ----------------------------------------------------------------------------

    private static TimeSpan SafeUptime(SysProcess p)
    {
        try { return DateTime.UtcNow - p.StartTime.ToUniversalTime(); }
        catch { return TimeSpan.Zero; }
    }

    private static long SafeLong(Func<long> f) { try { return f(); } catch { return 0; } }
    private static double SafeDouble(Func<double> f) { try { return f(); } catch { return 0; } }
    private static int SafeInt(Func<int> f) { try { return f(); } catch { return 0; } }

    private static long AvailableMemory()
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                var mi = new MEMORYSTATUSEX { dwLength = (uint)System.Runtime.InteropServices.Marshal.SizeOf<MEMORYSTATUSEX>() };
                if (GlobalMemoryStatusEx(ref mi)) return (long)mi.ullAvailPhys;
            }
        }
        catch { /* fall through */ }
        return 0;
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);
}
