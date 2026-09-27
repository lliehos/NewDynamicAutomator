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
/// loopback. On a server it is reached through a remote desktop session; it has no business being
/// on the public internet, and keeping it local means no token has to be invented and explained.
/// A request from anywhere else is told the application is not ready, without the detail.
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
        // The status probe is answered in EVERY phase, before the phase checks below. A progress
        // page already open in a browser keeps polling after initialisation finishes, and at that
        // moment the phase is Ready — if the probe fell through to MVC there (where no such route
        // exists) it would return 404, the page's poll would never see "ready", and the browser
        // would sit on the spinner forever. Answering it here is what lets the page navigate itself.
        if (IsStatusProbe(context.Request.Path))
        {
            await WriteStatusAsync(context);
            return;
        }

        if (_state.Phase == DatabaseSetupPhase.Ready)
        {
            await _next(context);
            return;
        }

        // While initialisation is running there is no page to redirect to and no error to explain —
        // the work is simply not finished. Serve the progress page in place, on whatever URL was
        // asked for, so the browser shows a spinner instead of hanging on a port that is not open
        // yet. This is why the initialiser was moved off the startup path.
        if (_state.Phase == DatabaseSetupPhase.Preparing)
        {
            if (IsProgressAsset(context.Request.Path))
            {
                await _next(context);
                return;
            }

            await WriteProgressPageAsync(context);
            return;
        }

        // The front page and the dedicated setup page both render the diagnosis, so both are let
        // through — the front page is the one an operator lands on by reflex, and redirecting it
        // away would hide the problem behind a URL nobody was told about. Static assets pass too:
        // the page that must be read cannot be served as unstyled HTML.
        if (IsAllowedWhileBlocked(context.Request.Path))
        {
            await _next(context);
            return;
        }

        if (!IsLoopback(context))
        {
            // Do not confirm what the problem is to an off-server caller. The operator on the server
            // gets the full explanation; everyone else gets "not ready".
            _log.LogWarning(
                "Blocked {Method} {Path} from {RemoteIp} while the database is not ready.",
                context.Request.Method, context.Request.Path, context.Connection.RemoteIpAddress);

            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.ContentType = "text/plain; charset=utf-8";
            await context.Response.WriteAsync(
                "The application is not ready: its database is not reachable. " +
                "See the server console for details.");
            return;
        }

        context.Response.Redirect("/");
    }

    /// <summary>JSON endpoint the progress page polls to learn when initialisation has finished.</summary>
    private static bool IsStatusProbe(PathString path) =>
        path.StartsWithSegments("/setup/status", StringComparison.OrdinalIgnoreCase);

    /// <summary>Assets the progress page needs. Inlined today, but kept for the same reason as below.</summary>
    private static bool IsProgressAsset(PathString path) =>
        path.StartsWithSegments("/favicon.ico", StringComparison.OrdinalIgnoreCase);

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
    /// True for the pages that explain the failure, and the static assets they need. Everything else
    /// is a normal application URL that cannot work without a database.
    /// </summary>
    private static bool IsAllowedWhileBlocked(PathString path) =>
        path == "/"
        || path == string.Empty
        || path.StartsWithSegments(SetupPathValue, StringComparison.OrdinalIgnoreCase)
        || path.StartsWithSegments("/css", StringComparison.OrdinalIgnoreCase)
        || path.StartsWithSegments("/lib", StringComparison.OrdinalIgnoreCase)
        || path.StartsWithSegments("/img", StringComparison.OrdinalIgnoreCase)
        || path.StartsWithSegments("/favicon.ico", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// True when the request came from the machine itself. Kestrel reports IPv4 and IPv6 loopback
    /// differently depending on the binding, so both are checked; <c>IsLoopback</c> covers the rest.
    /// </summary>
    private static bool IsLoopback(HttpContext context)
    {
        var ip = context.Connection.RemoteIpAddress;
        if (ip is null)
            return false;   // Unknown origin is not treated as trusted.
        if (System.Net.IPAddress.IsLoopback(ip))
            return true;
        return ip.IsIPv4MappedToIPv6 && System.Net.IPAddress.IsLoopback(ip.MapToIPv4());
    }
}
