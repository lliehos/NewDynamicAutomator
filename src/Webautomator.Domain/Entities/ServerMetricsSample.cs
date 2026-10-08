namespace Webautomator.Domain.Entities;

/// <summary>
/// One periodic reading of this server's resource usage, kept so the monitoring dashboard can show a
/// time range and not only "right now".
/// </summary>
/// <remarks>
/// A dedicated narrow table rather than reusing <see cref="AppEventLog"/>: these rows are written on a
/// fixed timer, carry only numbers, and are pruned by age, whereas the event log is written by
/// behaviour and must never be pruned silently. Mixing them would have forced one retention policy on
/// both and made every "what happened" query wade through metrics noise.
///
/// Numbers are stored as the raw counters (bytes, milliseconds, percentages) rather than formatted
/// text so the dashboard can aggregate a range — an average of pre-formatted strings is impossible.
/// </remarks>
public class ServerMetricsSample
{
    public long Id { get; set; }

    public DateTime CapturedAtUtc { get; set; } = DateTime.UtcNow;

    // ---- Host / process resources ---------------------------------------------------------------
    public long ProcessWorkingSetBytes { get; set; }
    public long ProcessPrivateBytes { get; set; }
    /// <summary>Free physical memory on the host, in bytes. 0 when the platform will not report it.</summary>
    public long AvailablePhysicalBytes { get; set; }
    public long TotalPhysicalBytes { get; set; }
    public long ManagedHeapBytes { get; set; }
    public double ProcessorSeconds { get; set; }
    public int ThreadCount { get; set; }
    public int Gen2Collections { get; set; }

    // ---- Disk (the owner's SECOND priority after the network) -----------------------------------
    /// <summary>Disk bytes read by this process since it started (cumulative counter).</summary>
    public long DiskReadBytes { get; set; }
    /// <summary>Disk bytes written by this process since it started (cumulative counter).</summary>
    public long DiskWriteBytes { get; set; }

    // ---- Network (the owner's FIRST priority) ---------------------------------------------------
    /// <summary>Bytes this process has received since it started (cumulative counter).</summary>
    public long NetworkReceivedBytes { get; set; }
    /// <summary>Bytes this process has sent since it started (cumulative counter).</summary>
    public long NetworkSentBytes { get; set; }

    // ---- Application load -----------------------------------------------------------------------
    /// <summary>Play sessions running at the moment of the reading.</summary>
    public int LiveSessions { get; set; }
    /// <summary>Users online within the online window at the moment of the reading.</summary>
    public int OnlineUsers { get; set; }
    /// <summary>Events written in the minute or so leading up to this reading (a load proxy).</summary>
    public int EventsLastMinute { get; set; }
    /// <summary>Warn/Error events in the same window.</summary>
    public int ProblemEventsLastMinute { get; set; }
    /// <summary>Round-trip time of the database probe at this reading, in milliseconds.</summary>
    public int DatabasePingMs { get; set; }
}
