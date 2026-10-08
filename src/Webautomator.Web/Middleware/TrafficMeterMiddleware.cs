using Webautomator.Infrastructure.Services;

namespace Webautomator.Web.Middleware;

/// <summary>
/// Feeds <see cref="TrafficMeter"/> with the size of each request and response, so the monitoring
/// dashboard can report this application's network bandwidth.
/// </summary>
/// <remarks>
/// Wraps the response stream to observe the bytes actually written, rather than trusting
/// <c>Content-Length</c>: responses are frequently chunked or compressed, and the header is absent or
/// wrong in exactly the cases (streaming, on-the-fly compression) where the real figure matters most.
/// The request side uses <c>ContentLength</c> when present, which is honest for the JSON bodies the
/// app's own APIs send.
///
/// Registered early so it wraps the whole pipeline — a byte written by static-file serving is just as
/// much "load on the network" as one written by a controller.
/// </remarks>
public sealed class TrafficMeterMiddleware
{
    private readonly RequestDelegate _next;

    public TrafficMeterMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        // Only count real request bodies. A ContentLength of 0 or null is the common case for a GET.
        if (context.Request.ContentLength is long reqLen && reqLen > 0)
            TrafficMeter.AddIn(reqLen);

        var original = context.Response.Body;
        await using var counter = new CountingStream(original);
        context.Response.Body = counter;

        try
        {
            await _next(context);
        }
        finally
        {
            // Always restore and always account, even when the request threw: the bytes that DID go
            // out are still load on the network, and leaving a wrapped stream installed would corrupt
            // anything that writes after us.
            context.Response.Body = original;
            TrafficMeter.AddOut(counter.BytesWritten);
        }
    }

    /// <summary>
    /// A pass-through stream that counts the bytes written. Reads and seeks are delegated untouched —
    /// this only observes the output side.
    /// </summary>
    private sealed class CountingStream : Stream
    {
        private readonly Stream _inner;
        public long BytesWritten { get; private set; }

        public CountingStream(Stream inner) => _inner = inner;

        public override bool CanRead => _inner.CanRead;
        public override bool CanSeek => _inner.CanSeek;
        public override bool CanWrite => _inner.CanWrite;
        public override long Length => _inner.Length;
        public override long Position { get => _inner.Position; set => _inner.Position = value; }

        public override void Flush() => _inner.Flush();
        public override Task FlushAsync(CancellationToken cancellationToken) => _inner.FlushAsync(cancellationToken);
        public override int Read(byte[] buffer, int offset, int count) => _inner.Read(buffer, offset, count);
        public override long Seek(long offset, SeekOrigin origin) => _inner.Seek(offset, origin);
        public override void SetLength(long value) => _inner.SetLength(value);

        public override void Write(byte[] buffer, int offset, int count)
        {
            _inner.Write(buffer, offset, count);
            BytesWritten += count;
        }

        public override async Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            await _inner.WriteAsync(buffer.AsMemory(offset, count), cancellationToken);
            BytesWritten += count;
        }

        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            await _inner.WriteAsync(buffer, cancellationToken);
            BytesWritten += buffer.Length;
        }
    }
}
