using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Morobot.Web.Services;

namespace Morobot.Web.Middleware;

/// <summary>
/// While the database is unusable, sends every request to the setup page so the operator sees what
/// is missing instead of an error page from a half-initialised application.
/// </summary>
/// <remarks>
/// <para>
/// Positioned early in the pipeline, before authentication and before the controllers, because at
/// this point there is no database to authenticate against — the sign-in form would itself fail.
/// The setup page and its retry action are let through so the operator can actually use it.
/// </para>
/// <para>
/// <b>Reachability.</b> The page shows the database name, the server name and the identity of the
/// process. None of that is a secret — the connection string's credentials are never rendered, and
/// under Windows authentication there are none to render — but the page is still restricted to
/// localhost: connection and URL both have to be local, which is what its footer promises. On a
/// server it is reached through a remote desktop session and then <c>http://localhost</c>; it has
/// no business being on the public internet, and keeping it local means no token has to be invented
/// and explained. A request from anywhere else is told the application is not ready, without the
/// detail.
/// </para>
/// </remarks>
public sealed class DatabaseSetupMiddleware
{
    /// <summary>The dedicated setup page, matched against <see cref="HttpRequest.Path"/>.</summary>
    private const string SetupPathValue = "/setup/database";

    private readonly RequestDelegate _next;
    private readonly DatabaseSetupState _state;
    private readonly ILogger<DatabaseSetupMiddleware> _log;

    public DatabaseSetupMiddleware(
        RequestDelegate next, DatabaseSetupState state, ILogger<DatabaseSetupMiddleware> log)
    {
        _next = next;
        _state = state;
        _log = log;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Whether this request came from the machine itself decides the WHOLE shape of the answer,
        // not just the final branch. Every page below explains a database problem — the setup page
        // even prints the SQL error — and the setup page's own footer promises it "is only visible
        // from the server". Serving any of it to an off-server caller both breaks that promise and
        // exposes the deployment's internals, which is exactly what an earlier version did when it
        // let "/" through to the diagnosis and then checked loopback only afterwards.
        var local = IsLocalRequest(context);

        // The status probe is answered in EVERY phase, before the phase checks below. A progress
        // page already open in a browser keeps polling after initialisation finishes, and at that
        // moment the phase is Ready — if the probe fell through to MVC there (where no such route
        // exists) it would return 404, the page's poll would never see "ready", and the browser
        // would sit on the spinner forever. Answering it here is what lets the page navigate itself.
        if (IsStatusProbe(context.Request.Path))
        {
            if (local)
            {
                await WriteStatusAsync(context);
                return;
            }

            await WriteNotReadyAsync(context);
            return;
        }

        if (_state.Phase == DatabaseSetupPhase.Ready)
        {
            await _next(context);
            return;
        }

        // Static assets carry no diagnosis and the pages that are shown on the server cannot be
        // read as unstyled HTML, so they pass for anyone.
        if (IsStaticAsset(context.Request.Path))
        {
            await _next(context);
            return;
        }

        // While initialisation is running there is no page to redirect to and no error to explain —
        // the work is simply not finished. The server shows a spinner in place of whatever URL was
        // asked for, so nobody has to sit on a port that is not open yet; off-server callers are
        // told the application is not ready and nothing more. This is why the initialiser was moved
        // off the startup path.
        if (_state.Phase == DatabaseSetupPhase.Preparing)
        {
            if (local)
            {
                await WriteProgressPageAsync(context);
                return;
            }

            await WriteNotReadyAsync(context);
            return;
        }

        // The diagnosis itself is the server's business: the front page (the one an operator lands
        // on by reflex) and the dedicated setup URL both render it, and only from the machine the
        // operator is already sitting at.
        if (local && IsDiagnosisPath(context.Request.Path))
        {
            await _next(context);
            return;
        }

        if (!local)
        {
            // Do not confirm what the problem is to an off-server caller.
            await WriteNotReadyAsync(context);
            return;
        }

        context.Response.Redirect("/");
    }

    /// <summary>
    /// The off-server answer: a flat 503 with no phase, no SQL error and no hint about the cause.
    /// </summary>
    private async Task WriteNotReadyAsync(HttpContext context)
    {
        _log.LogWarning(
            "Blocked {Method} {Path} for host {Host} from {RemoteIp} while the database is not ready.",
            context.Request.Method, context.Request.Path, context.Request.Host.Value,
            context.Connection.RemoteIpAddress);

        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        context.Response.ContentType = "text/plain; charset=utf-8";
        // The last sentence is for the operator who reached the server over its public name instead
        // of localhost: the page they are looking for is one URL away, and without this they would
        // be left with a bare 503 and no way in.
        await context.Response.WriteAsync(
            "The application is not ready: its database is not reachable. " +
            "See the server console for details. " +
            "On the server itself, open the site through http://localhost to see the diagnosis.");
    }

    /// <summary>JSON endpoint the progress page polls to learn when initialisation has finished.</summary>
    private static bool IsStatusProbe(PathString path) =>
        path.StartsWithSegments("/setup/status", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The static asset roots the diagnosis pages need. Inlined today, but kept because the page that
    /// must be read cannot be served as unstyled HTML.
    /// </summary>
    private static bool IsStaticAsset(PathString path) =>
        path.StartsWithSegments("/css", StringComparison.OrdinalIgnoreCase)
        || path.StartsWithSegments("/lib", StringComparison.OrdinalIgnoreCase)
        || path.StartsWithSegments("/img", StringComparison.OrdinalIgnoreCase)
        || path.StartsWithSegments("/favicon.ico", StringComparison.OrdinalIgnoreCase);

    private Task WriteStatusAsync(HttpContext context)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        // no-store: the page polls this and a cached "still preparing" would strand it.
        context.Response.Headers.CacheControl = "no-store";

        var payload = new
        {
            phase = _state.Phase.ToString(),
            ready = _state.IsReady,
            message = _state.ProgressMessage
        };
        return context.Response.WriteAsync(
            System.Text.Json.JsonSerializer.Serialize(payload));
    }

    /// <summary>
    /// The spinner page shown while initialisation runs.
    /// </summary>
    /// <remarks>
    /// Written inline rather than as a view: it must render before the application is initialised, so
    /// it must not depend on anything initialisation touches — no layout, no localisation service, no
    /// branding read. That constraint is also why the text is embedded rather than resolved from the
    /// locale files, and why it is short.
    /// </remarks>
    private async Task WriteProgressPageAsync(HttpContext context)
    {
        context.Response.StatusCode = StatusCodes.Status200OK;
        context.Response.ContentType = "text/html; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";

        var message = System.Net.WebUtility.HtmlEncode(_state.ProgressMessage);
        if (string.IsNullOrWhiteSpace(message))
            message = "لطفاً چند لحظه صبر کنید…";

        await context.Response.WriteAsync($$"""
            <!doctype html>
            <html lang="fa" dir="rtl">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <title>در حال راه‌اندازی — Morobot</title>
              <!--
                The same font stack the rest of the application uses. This page renders before the
                database exists, but a web font needs nothing from the application, so linking it
                here is safe. Tahoma stays in the stack as the fallback for an air-gapped server,
                where the request to Google Fonts will simply fail and the browser moves on.
              -->
              <link rel="preconnect" href="https://fonts.googleapis.com" />
              <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
              <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet" />
              <style>
                :root { --brand: #0d9488; --brand-soft: #ecfdf5; }
                body {
                  margin: 0; min-height: 100vh; display: grid; place-items: center;
                  font-family: Vazirmatn, Tahoma, "Segoe UI", sans-serif;
                  background: #f9fafb; color: #1f2937; text-align: center;
                }
                .box { padding: 2rem; max-width: 28rem; }
                .gear {
                  width: 56px; height: 56px; margin: 0 auto 1.5rem;
                  border: 5px solid #e5e7eb; border-top-color: var(--brand); border-right-color: var(--brand);
                  border-radius: 50%;
                  animation: spin 1s linear infinite;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
                h1 { font-size: 1.15rem; margin: 0 0 .5rem; font-weight: 700; letter-spacing: -.01em; }
                p { color: #6b7280; font-size: .95rem; margin: 0; min-height: 1.4em; }
                .hint { margin-top: 1.5rem; font-size: .8rem; color: #9ca3af; }
                @@media (prefers-reduced-motion: reduce) {
                  .gear { animation-duration: 3s; }
                }
              </style>
            </head>
            <body>
              <div class="box">
                <div class="gear" role="progressbar" aria-label="در حال راه‌اندازی"></div>
                <h1>در حال اعمال تنظیمات سامانه</h1>
                <p id="msg">{{message}}</p>
                <div class="hint">این صفحه به‌صورت خودکار به‌روزرسانی می‌شود.</div>
              </div>
              <script>
                (function () {
                  var msg = document.getElementById('msg');
                  function poll() {
                    fetch('/setup/status', { cache: 'no-store' })
                      .then(function (r) { return r.json(); })
                      .then(function (s) {
                        if (s.ready) { location.replace('/'); return; }
                        if (s.phase === 'Blocked') { location.replace('/setup/database'); return; }
                        if (s.message) { msg.textContent = s.message; }
                        setTimeout(poll, 1500);
                      })
                      .catch(function () { setTimeout(poll, 2500); });
                  }
                  setTimeout(poll, 1200);
                })();
              </script>
            </body>
            </html>
            """);
    }

    /// <summary>
    /// True for the pages that explain the failure to whoever is sitting at the server: the front
    /// page and the dedicated setup URL. Everything else is a normal application URL that cannot
    /// work without a database.
    /// </summary>
    private static bool IsDiagnosisPath(PathString path) =>
        path == "/"
        || path == string.Empty
        || path.StartsWithSegments(SetupPathValue, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// True when the request came from the machine itself — from the connection <i>and</i> the URL.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Both halves are needed. The connection address alone is not enough: behind the reverse proxy
    /// this application is deployed with (IIS out-of-process, or the documented nginx), the socket
    /// really does come from 127.0.0.1, so every caller on the network would be taken for the
    /// server and shown the diagnosis — which is exactly what happened in production, where a
    /// colleague opened the address from his own machine and read the page that says it is only
    /// visible on the server.
    /// </para>
    /// <para>
    /// The forwarded client IP is deliberately not consulted: it arrives in a header, nothing here
    /// validates it, and a caller could then claim to be localhost. The page's own footer promises
    /// localhost, so the URL is what decides — an operator on the server opens it through
    /// <c>http://localhost</c> or <c>http://127.0.0.1</c>, and a request addressed to the public
    /// name is not local no matter who made it.
    /// </para>
    /// </remarks>
    private static bool IsLocalRequest(HttpContext context)
    {
        if (!IsLoopbackAddress(context.Connection.RemoteIpAddress))
            return false;

        // Host.Host drops the port and brackets an IPv6 literal, but the bracket is kept for the
        // values Kestrel accepts, so both spellings are compared.
        var host = context.Request.Host.Host;
        return host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || host.Equals("::1", StringComparison.OrdinalIgnoreCase)
            || host.Equals("[::1]", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Kestrel reports IPv4 and IPv6 loopback differently depending on the binding, so both are
    /// checked; <c>IsLoopback</c> covers the rest.
    /// </summary>
    private static bool IsLoopbackAddress(System.Net.IPAddress? ip)
    {
        if (ip is null)
            return false;   // Unknown origin is not treated as trusted.
        if (System.Net.IPAddress.IsLoopback(ip))
            return true;
        return ip.IsIPv4MappedToIPv6 && System.Net.IPAddress.IsLoopback(ip.MapToIPv4());
    }
}
