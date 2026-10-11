using System.Collections.Concurrent;
using System.Threading;

namespace Webautomator.Infrastructure.Services;

/// <summary>
/// Counts the bytes this application has received and sent over HTTP, so the monitoring dashboard can
/// report network bandwidth.
/// </summary>
/// <remarks>
/// Why a meter and not a system counter: the owner's headline question is "what load is this putting
/// on the network", and the honest denominator is THIS application's traffic — not the whole host's,
/// which would include every other tenant on the box, and not a per-socket guess, which is not
/// available. .NET exposes no per-process network byte counter on any platform, so the bytes are
/// counted where they are actually produced: in the request pipeline (see
/// <c>TrafficMeterMiddleware</c>).
///
/// The counters are plain <see cref="Interlocked"/> longs on a static class. That is deliberate:
/// they are touched on every request, so a per-request allocation or a lock would show up in the very
/// latency the dashboard is meant to watch. A cumulative counter is fine because a rate is a
/// DIFFERENCE of two readings — the sampler stores the running total and the dashboard differences
/// consecutive samples.
/// </remarks>
public static class TrafficMeter
{
    private static long _bytesIn;
    private static long _bytesOut;

    /// <summary>Total request bytes received since the process started.</summary>
    public static long BytesIn => Interlocked.Read(ref _bytesIn);

    /// <summary>Total response bytes sent since the process started.</summary>
    public static long BytesOut => Interlocked.Read(ref _bytesOut);

    /// <summary>Called with the request body size (0 when there is none).</summary>
    public static void AddIn(long bytes)
    {
        if (bytes > 0) Interlocked.Add(ref _bytesIn, bytes);
    }

    /// <summary>Called with the response body size once it is known.</summary>
    public static void AddOut(long bytes)
    {
        if (bytes > 0) Interlocked.Add(ref _bytesOut, bytes);
    }

    /// <summary>Per-user totals, keyed by the user id as text ("anon" for unauthenticated traffic).</summary>
    private static readonly ConcurrentDictionary<string, long[]> ByUser = new(StringComparer.Ordinal);

    /// <summary>Per-address totals, keyed by the client IP (or "unknown" when it cannot be read).</summary>
    private static readonly ConcurrentDictionary<string, long[]> ByIp = new(StringComparer.Ordinal);

    /// <summary>
    /// Account one finished request against both the acting user and the client address.
    /// </summary>
    /// <remarks>
    /// Called once per request, after the response has been written. Anonymous traffic is attributed
    /// too — an unauthenticated flood is exactly what a dashboard about traffic should show — under a
    /// fixed key, so "who is generating this" has an answer for every byte. Attribution is exact for
    /// everything that reaches this application; it deliberately does NOT try to account for traffic
    /// the user's own browser generates elsewhere, which never passes through here.
    /// </remarks>
    public static void AddRequest(string? userId, string? ipAddress, long bytesIn, long bytesOut)
    {
        if (bytesIn <= 0 && bytesOut <= 0) return;

        Add(ByUser, string.IsNullOrWhiteSpace(userId) ? "anon" : userId!, bytesIn, bytesOut);
        Add(ByIp, string.IsNullOrWhiteSpace(ipAddress) ? "unknown" : ipAddress!, bytesIn, bytesOut);
    }

    private static void Add(ConcurrentDictionary<string, long[]> map, string key, long bytesIn, long bytesOut)
    {
        var slot = map.GetOrAdd(key, static _ => new long[2]);
        if (bytesIn > 0) Interlocked.Add(ref slot[0], bytesIn);
        if (bytesOut > 0) Interlocked.Add(ref slot[1], bytesOut);
    }

    /// <summary>Every per-user total seen since the process started.</summary>
    public static IReadOnlyList<TrafficTotal> UserTotals() => Snapshot(ByUser);

    /// <summary>Every per-address total seen since the process started.</summary>
    public static IReadOnlyList<TrafficTotal> IpTotals() => Snapshot(ByIp);

    private static IReadOnlyList<TrafficTotal> Snapshot(ConcurrentDictionary<string, long[]> map) =>
        map.Select(kv => new TrafficTotal(kv.Key, Interlocked.Read(ref kv.Value[0]), Interlocked.Read(ref kv.Value[1])))
            .ToList();
}

/// <summary>One user's (or one address's) share of this application's HTTP traffic, as a running total.</summary>
/// <param name="Key">The user id as a string, or <c>anon</c>/<c>unknown</c> for unattributed traffic.</param>
/// <param name="BytesIn">Request bytes attributed to this key since the process started.</param>
/// <param name="BytesOut">Response bytes attributed to this key since the process started.</param>
public sealed record TrafficTotal(string Key, long BytesIn, long BytesOut);
