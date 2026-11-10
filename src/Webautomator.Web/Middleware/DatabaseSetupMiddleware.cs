using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Webautomator.Web.Services;

namespace Webautomator.Web.Middleware;

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
        // Re-assert the process-level logging switch on every request. IIS serves a worker with
        // ASPNETCORE_ENVIRONMENT reset to the host's value unless the version is pinned, and the pinned
        // version has no per-request counterpart for DOTNET_DisableFallbackConsole — so a worker that
        // started with Program.cs's setting can silently lose it. Setting it here covers both cases:
        // the managed host keeps the value, and a worker that re-created its logger from the environment
        // gets the switch back before anything tries to log from an event-log-less state.
        Environment.SetEnvironmentVariable("DOTNET_DisableFallbackConsole", "none");

        // Whether this request came from the machine itself decides the WHOLE shape of the answer,
        // not just the final branch. Every page below explains a database problem — the setup page
        // even prints the SQL error — and the setup page's own footer promises it "is only visible
        // from the server". Serving any of it to an off-server caller both breaks that promise and
        // exposes the deployment's internals, which is exactly what an earlier version did when it
        // let "/" through to the diagnosis and then checked loopback only afterwards.
        var local = IsLocalRequest(context);

        // The status probe is answered in EVERY phase and for EVERY caller, before the phase checks
        // below. Two things depend on that. A progress page already open in a browser keeps polling
        // after initialisation finishes, and at that moment the phase is Ready — if the probe fell
        // through to MVC there (where no such route exists) it would return 404, the poll would never
        // see "ready", and the browser would sit on the spinner forever. And the warm-up page below is
        // served behind the public name too, so its poll would otherwise be answered with 503 and the
        // page would stall. The payload carries no diagnosis — only the phase name and a progress
        // sentence — so answering off-server callers reveals nothing the 503 did not already say.
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

        // A page is requested while startup work is still finishing (or right after a restart, before
        // the first request has touched the database). Bridge that gap with a small waiting page that
        // follows the status probe: to the requested URL when the application is ready, to the
        // diagnosis page if the phase settles on Blocked. On-server, the setup and front pages are
        // excluded, so a real failure is never hidden behind it.
        //
        // On-server callers get it too rather than the progress page: the progress page lists the
        // setup steps and is the wrong answer for someone who just opened the site, and the waiting
        // page ends in the same place. Off-server callers get it instead of a bare 503 — that is the
        // whole point, since a 503 with no way forward was indistinguishable from an outage and made
        // the first visit after a restart look like a database failure until someone refreshed.
        //
        // `local` is passed because the diagnosis paths are only "the diagnosis" for a caller that can
        // actually read them. For anyone else "/" and /setup/database are ordinary URLs, and excluding
        // them sent the site's own front page — the one URL every visitor types — into the bare-503
        // branch below, which is exactly the white "application is not ready" page seen on the first
        // visit after a publish recycle.
        if (WantsHtmlPage(context, local))
        {
            await WriteWarmUpPageAsync(context, local);
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
        // Non-HTML callers (curl, an API client, a health check) get the same plain answer; telling them
        // when to come back stops a retry storm while the initialiser is still working.
        context.Response.Headers.RetryAfter = "5";
        // The last sentence is for the operator who reached the server over its public name instead
        // of localhost: the page they are looking for is one URL away, and without this they would
        // be left with a bare 503 and no way in.
        //
        // The wording covers both phases on purpose. Most of these answers are written while the
        // background initialiser is still running, so naming only the database sent operators looking
        // for a broken connection when the application was merely a few seconds from ready.
        await context.Response.WriteAsync(
            "The application is not ready yet: it is still starting up, or its database is not " +
            "reachable. See the server console for details. " +
            "On the server itself, open the site through http://localhost to see the diagnosis.");
    }

    /// <summary>JSON endpoint the progress page polls to learn when initialisation has finished.</summary>
    private static bool IsStatusProbe(PathString path) =>
        path.StartsWithSegments("/setup/status", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// True when the caller is asking for a page a person can look at, rather than for an asset, an
    /// API response or a socket. Used to decide whether the warm-up page is a sensible answer.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Shallow on purpose. A caller that negotiates for something other than HTML is left to the
    /// phase branches below (503 off-server, diagnosis on-server); mutating verbs are never answered
    /// with a page whose reload would replay them.
    /// </para>
    /// <para>
    /// <paramref name="local"/> decides what the diagnosis paths mean. On the server they are the
    /// operator's way IN, so they must never be replaced by a waiting page — that would leave a
    /// genuine failure unreachable. Off-server the diagnosis is not served at all, so those paths are
    /// just URLs, and a visitor there needs the warm-up page more than anyone: without it the first
    /// hit after a restart is answered with a bare text 503 on a white page.
    /// </para>
    /// </remarks>
    private static bool WantsHtmlPage(HttpContext context, bool local)
    {
        if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
            return false;

        var path = context.Request.Path;
        if (path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/hubs", StringComparison.OrdinalIgnoreCase))
            return false;

        // Never hide the operator's own way in behind a waiting page — but only where that page is
        // actually served. See the remarks above.
        if (local && IsDiagnosisPath(path))
            return false;

        var accept = context.Request.Headers.Accept.ToString();
        if (accept.Length > 0)
        {
            // A fetch() default of "*/*" counts as a page; an explicit non-HTML preference does not.
            if (accept.Contains("application/json", StringComparison.OrdinalIgnoreCase)
                && !accept.Contains("text/html", StringComparison.OrdinalIgnoreCase))
                return false;

            if (accept.Contains("text/event-stream", StringComparison.OrdinalIgnoreCase))
                return false;
        }

        return true;
    }

    /// <summary>
    /// The page served to a browser that arrives while startup is still in progress.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Without this, the first hit on a freshly started server is answered before the background
    /// initialiser has finished, and the visitor sees "database not reachable" or a bare "not ready"
    /// that a plain refresh then contradicts. The page below turns that first experience into a short
    /// wait: it asks the status probe, and follows the answer wherever it leads — to the diagnosis if
    /// something is genuinely broken, to the progress page while first-run work is running, or back to
    /// the URL that was asked for once the application is ready.
    /// </para>
    /// <para>
    /// It is inline, unstyled-by-the-application and dependency-free on purpose: it is emitted during
    /// startup, when no layout, branding or localisation can be trusted to read from the database. The
    /// text follows the <c>Accept-Language</c> header rather than the culture middleware, which has not
    /// run yet.
    /// </para>
    /// <para>
    /// <paramref name="local"/> changes only the Blocked branch. On the server the redirect to the
    /// diagnosis is the point; off-server that page is refused, so the redirect would land the visitor
    /// on the very plain-text 503 this page exists to replace. There it settles into a short
    /// "not available" notice instead and keeps polling, so it still recovers on its own once the
    /// operator fixes the database on the server.
    /// </para>
    /// </remarks>
    private async Task WriteWarmUpPageAsync(HttpContext context, bool local)
    {
        // Preparing is a wait, Blocked is an outage. Reporting the second as 200 would tell a load
        // balancer and a search engine that all is well; the page still polls, so the visitor is not
        // stranded either way.
        var blocked = _state.Phase == DatabaseSetupPhase.Blocked;
        context.Response.StatusCode = blocked
            ? StatusCodes.Status503ServiceUnavailable
            : StatusCodes.Status200OK;
        context.Response.ContentType = "text/html; charset=utf-8";
        // The page is different on every visit (ready or not), so it must never be replayed by a cache.
        context.Response.Headers.CacheControl = "no-store, no-cache";
        context.Response.Headers.RetryAfter = blocked ? "5" : "2";

        var english = PrefersEnglish(context);
        var title = english ? "Starting up" : "در حال آماده‌سازی سامانه";
        var message = english ? "The system is getting ready. This page refreshes itself." : "سامانه در حال آماده‌سازی است. این صفحه خودکار به‌روزرسانی می‌شود.";
        var hint = english ? "If it does not continue on its own, open /setup/database on the server." : "اگر ادامه پیدا نکرد، روی سرور نشانی /setup/database را باز کنید.";
        var unavailable = english
            ? "The system is not available right now. This page keeps checking and continues on its own once the service is ready."
            : "سامانه در حال حاضر در دسترس نیست. این صفحه وضعیت را بررسی می‌کند و پس از آماده‌شدن سرویس، خودکار ادامه می‌دهد.";
        var lang = english ? "en" : "fa";
        var dir = english ? "ltr" : "rtl";

        // A blocked deployment that is already known to be such opens on the notice, not on a spinner
        // that would only tell the truth 700 ms later.
        var openBlocked = blocked && !local;
        var initialMessage = openBlocked ? unavailable : message;
        var htmlInitialMessage = System.Net.WebUtility.HtmlEncode(initialMessage);
        var gearStyle = openBlocked ? "display:none" : "";

        // The visitor's original URL, so the reload lands where they were going. Escaped because it is
        // reflected into script and markup.
        var target = context.Request.Path + context.Request.QueryString;
        var safeTarget = System.Text.Json.JsonSerializer.Serialize(target);
        var safeUnavailable = System.Text.Json.JsonSerializer.Serialize(unavailable);
        var htmlTarget = System.Net.WebUtility.HtmlEncode(target);
        var canDiagnose = local ? "true" : "false";

        await context.Response.WriteAsync($$"""
            <!doctype html>
            <html lang="{{lang}}" dir="{{dir}}">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <title>{{title}}</title>
              <style>
                body {
                  margin: 0; min-height: 100vh; display: grid; place-items: center;
                  font-family: Vazirmatn, Tahoma, "Segoe UI", sans-serif;
                  background: #f9fafb; color: #1f2937; text-align: center;
                }
                .box { padding: 2rem; max-width: 30rem; }
                .gear {
                  width: 56px; height: 56px; margin: 0 auto 1.5rem;
                  border: 5px solid #e5e7eb; border-top-color: #0d9488; border-right-color: #0d9488;
                  border-radius: 50%; animation: spin 1s linear infinite;
                }
                @keyframes -webkit-spin { to { transform: rotate(360deg); } }
                @keyframes spin { to { transform: rotate(360deg); } }
                h1 { font-size: 1.15rem; margin: 0 0 .5rem; font-weight: 700; }
                p { color: #6b7280; font-size: .95rem; margin: 0; }
                .hint { margin-top: 1.5rem; font-size: .8rem; color: #9ca3af; }
                @media (prefers-reduced-motion: reduce) { .gear { animation-duration: 3s; } }
              </style>
            </head>
            <body>
              <div class="box">
                <div class="gear" id="gear" style="{{gearStyle}}" role="progressbar" aria-label="{{title}}"></div>
                <h1 id="title">{{title}}</h1>
                <p id="msg">{{htmlInitialMessage}}</p>
                <div class="hint">{{hint}}</div>
              </div>
              <script>
                (function () {
                  var target = {{safeTarget}};
                  var canDiagnose = {{canDiagnose}};
                  var unavailable = {{safeUnavailable}};
                  var settled = false;
                  function poll() {
                    fetch('/setup/status', { cache: 'no-store' })
                      .then(function (r) { return r.json(); })
                      .then(function (s) {
                        if (s.ready) { location.replace(target || '/'); return; }
                        if (s.phase === 'Blocked') {
                          // On the server the diagnosis is one URL away. Anywhere else that URL is
                          // refused, so redirecting there would replace this page with a bare 503.
                          if (canDiagnose) { location.replace('/setup/database'); return; }
                          settled = true;
                          document.getElementById('gear').style.display = 'none';
                          document.getElementById('msg').textContent = unavailable;
                          setTimeout(poll, 5000);
                          return;
                        }
                        if (settled) { settled = false; }
                        setTimeout(poll, 1000);
                      })
                      .catch(function () { setTimeout(poll, 1500); });
                  }
                  setTimeout(poll, 700);
                })();
              </script>
              <noscript>
                <p><a href="{{htmlTarget}}">{{title}}</a></p>
              </noscript>
            </body>
            </html>
            """);
    }

    /// <summary>
    /// Decides the warm-up page's language from the one header available before the culture
    /// middleware has run.
    /// </summary>
    private static bool PrefersEnglish(HttpContext context)
    {
        var languages = context.Request.Headers.AcceptLanguage.ToString();
        return languages.Length > 0
            && languages.TrimStart().StartsWith("en", StringComparison.OrdinalIgnoreCase);
    }

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
            message = _state.ProgressMessage,
            // Whether the diagnosis page is reachable from HERE. It is served on loopback only, so a
            // remote caller that learns "Blocked" must not be sent to it — it would be refused.
            // This is not a secret: it merely restates that the caller is not on the server.
            diagnosis = IsLocalRequest(context)
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
              <title>در حال راه‌اندازی — Webautomator</title>
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
                @media (prefers-reduced-motion: reduce) {
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
    /// True for the pages that explain the failure: the front page and the dedicated setup URL.
    /// Everything else is a normal application URL that cannot work without a database.
    /// </summary>
    /// <remarks>
    /// The front page is included because it is where an operator lands by reflex, and on a local
    /// request it renders the diagnosis itself. It is excluded from the warm-up page for the same
    /// reason as the setup URL: a genuine failure must stay one URL away instead of hiding behind a
    /// spinner that will poll a status that has already settled on Blocked.
    /// </remarks>
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
