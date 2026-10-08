using Microsoft.EntityFrameworkCore;
using Webautomator.Domain.Entities;
using Webautomator.Infrastructure.Persistence;
using Webautomator.Infrastructure.Services;

namespace Webautomator.Web.Services;

/// <summary>
/// Writes one <see cref="ServerMetricsSample"/> every minute, and prunes samples older than the
/// retention window.
/// </summary>
/// <remarks>
/// The monitoring dashboard shows a TIME RANGE, so a series has to exist somewhere before anyone asks
/// for it — a dashboard that only reads live counters can never answer "what did last night look
/// like". This is that series. It is a plain timer rather than a per-request hook on purpose: load has
/// to be measurable even when the app is idle, and a request-triggered sampler would miss exactly the
/// quiet periods an operator wants to compare against.
///
/// The scope is created per tick, because <see cref="AppDbContext"/> is scoped and a hosted service is
/// a singleton — capturing a context in the constructor would keep one alive for the process life and
/// let its change tracker grow without bound.
/// </remarks>
public sealed class MetricsSamplerService : BackgroundService
{
    /// <summary>How often a sample is taken. One minute is fine-grained enough to see a spike and
    /// coarse enough that a month of history stays small.</summary>
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    /// <summary>Samples older than this are deleted. Two weeks is the range the dashboard offers.</summary>
    private static readonly TimeSpan Retention = TimeSpan.FromDays(14);

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<MetricsSamplerService> _log;
    private readonly PlaySessionTracker _plays;

    public MetricsSamplerService(
        IServiceScopeFactory scopes,
        ILogger<MetricsSamplerService> log,
        PlaySessionTracker plays)
    {
        _scopes = scopes;
        _log = log;
        _plays = plays;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // A first sample on startup so the dashboard has a point to show immediately rather than
        // waiting a full interval for the very first one.
        await SampleOnceAsync(stoppingToken);

        using var timer = new PeriodicTimer(Interval);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
            }
            catch (OperationCanceledException)
            {
                break;
            }
            await SampleOnceAsync(stoppingToken);
        }
    }

    private async Task SampleOnceAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var events = scope.ServiceProvider.GetRequiredService<EventLogService>();

            // The database may not be migrated yet on a fresh install; skip quietly rather than
            // logging an error every minute until it is.
            if (!await db.Database.CanConnectAsync(ct)) return;

            var now = DateTime.UtcNow;
            var minuteAgo = now.AddMinutes(-1);

            var proc = System.Diagnostics.Process.GetCurrentProcess();
            var counters = MonitoringService.ReadCounters(proc);

            var eventsLastMinute = await db.EventLogs.AsNoTracking()
                .CountAsync(e => e.CreatedAtUtc >= minuteAgo, ct);
            var problemsLastMinute = await db.EventLogs.AsNoTracking()
                .CountAsync(e => e.CreatedAtUtc >= minuteAgo
                                 && (e.Level == "Error" || e.Level == "Warning" || e.Level == "Warn"), ct);

            var pingMs = 0;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try { _ = await db.Users.AsNoTracking().Select(u => u.Id).FirstOrDefaultAsync(ct); }
            catch { /* ping failed; record 0 below */ }
            sw.Stop();
            pingMs = (int)Math.Round(sw.Elapsed.TotalMilliseconds);

            // Online users is computed the same way the dashboard does it, from the presence table.
            var onlineWindow = now.AddMinutes(-15);
            var onlineUsers = await db.DeviceSessions.AsNoTracking()
                .Where(d => d.LastSeenUtc >= onlineWindow)
                .Select(d => d.UserId).Distinct().CountAsync(ct);

            db.ServerMetricsSamples.Add(new ServerMetricsSample
            {
                CapturedAtUtc = now,
                ProcessWorkingSetBytes = SafeStat(() => proc.WorkingSet64),
                ProcessPrivateBytes = SafeStat(() => proc.PrivateMemorySize64),
                AvailablePhysicalBytes = AvailableMemory(),
                TotalPhysicalBytes = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes,
                ManagedHeapBytes = GC.GetTotalMemory(forceFullCollection: false),
                ProcessorSeconds = SafeStatD(() => proc.TotalProcessorTime.TotalSeconds),
                ThreadCount = SafeStatI(() => proc.Threads.Count),
                Gen2Collections = GC.CollectionCount(2),
                DiskReadBytes = counters.DiskRead,
                DiskWriteBytes = counters.DiskWrite,
                NetworkReceivedBytes = counters.NetIn,
                NetworkSentBytes = counters.NetOut,
                LiveSessions = _plays.ListPlaying().Count,
                OnlineUsers = onlineUsers,
                EventsLastMinute = eventsLastMinute,
                ProblemEventsLastMinute = problemsLastMinute,
                DatabasePingMs = pingMs
            });
            await db.SaveChangesAsync(ct);

            // Prune by age. Done on the same tick so no separate job is needed, and only when there
            // is almost certainly something to remove (cheap guard against a query per minute).
            var cutoff = now - Retention;
            var stale = await db.ServerMetricsSamples.Where(s => s.CapturedAtUtc < cutoff).ToListAsync(ct);
            if (stale.Count > 0)
            {
                db.ServerMetricsSamples.RemoveRange(stale);
                await db.SaveChangesAsync(ct);
            }
        }
        catch (OperationCanceledException)
        {
            // Shutting down; nothing to report.
        }
        catch (Exception ex)
        {
            // A monitoring failure must never take the app down; log once and let the next tick retry.
            _log.LogWarning(ex, "Metrics sample failed");
        }
    }

    private static long SafeStat(Func<long> f) { try { return f(); } catch { return 0; } }
    private static double SafeStatD(Func<double> f) { try { return f(); } catch { return 0; } }
    private static int SafeStatI(Func<int> f) { try { return f(); } catch { return 0; } }

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
        catch { /* not reported here */ }
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
