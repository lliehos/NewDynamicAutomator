using System.Threading;

namespace Morobot.Infrastructure.Services;

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
}
