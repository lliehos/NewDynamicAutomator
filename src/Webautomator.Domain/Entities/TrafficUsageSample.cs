namespace Webautomator.Domain.Entities;

/// <summary>Which dimension a <see cref="TrafficUsageSample"/> row counts.</summary>
public enum TrafficScope
{
    /// <summary>The row is one user's share (<c>Key</c> is the user id, or "anon").</summary>
    User = 0,
    /// <summary>The row is one client address's share (<c>Key</c> is the IP, or "unknown").</summary>
    Ip = 1
}

/// <summary>
/// One minute of this application's HTTP traffic, attributed to a single user or a single client
/// address, kept so the monitoring dashboard can show WHO the traffic belongs to over a time range.
/// </summary>
/// <remarks>
/// The host-level <see cref="ServerMetricsSample"/> already answers "how much traffic was there"; it
/// cannot answer "whose", because it is one row for the whole process. This table holds the missing
/// dimension as <i>deltas</i>: one row per key per minute, so a range is a plain SUM and the retention
/// prune is the same age-based delete the metrics sampler already performs.
///
/// Deltas rather than cumulative counters, unlike <see cref="ServerMetricsSample"/>: the per-key
/// counters live in memory (<c>TrafficMeter</c>) and start from zero on every restart, so a stored
/// running total would be meaningless after one. The sampler differences its own last reading instead,
/// which also makes a restarted process contribute only the traffic it actually served.
/// </remarks>
public class TrafficUsageSample
{
    public long Id { get; set; }

    public DateTime CapturedAtUtc { get; set; } = DateTime.UtcNow;

    /// <summary>Whether <see cref="Key"/> names a user or an address.</summary>
    public TrafficScope Scope { get; set; }

    /// <summary>The user id as text, the literal "anon", an IP address, or "unknown".</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>Request bytes attributed to this key during the sampled minute.</summary>
    public long BytesIn { get; set; }

    /// <summary>Response bytes attributed to this key during the sampled minute.</summary>
    public long BytesOut { get; set; }
}
