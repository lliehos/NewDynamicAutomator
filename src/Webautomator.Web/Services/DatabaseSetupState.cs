﻿using Microsoft.Extensions.Logging;
using Webautomator.Infrastructure.Services;

namespace Webautomator.Web.Services;

/// <summary>
/// The application's first-run sequence. The middleware switches on this every request, so the
/// transitions are the contract: Preparing → (Ready | Blocked), and Blocked → Ready via a retry.
/// </summary>
public enum DatabaseSetupPhase
{
    /// <summary>First-run initialisation is running in the background; a progress page is served.</summary>
    Preparing = 0,

    /// <summary>Database reachable and initialisation finished; the application serves normally.</summary>
    Ready = 1,

    /// <summary>A prerequisite is missing and only an operator can supply it; the setup page is served.</summary>
    Blocked = 2
}

/// <summary>
/// Holds the outcome of the startup database check for the lifetime of the process, and re-runs it
/// on demand so an operator can fix the database and continue without restarting the service.
/// </summary>
/// <remarks>
/// <para>
/// This exists because the database check runs before the web host starts listening, and a failure
/// there used to mean the process exited — leaving the operator with a console trace and no way to
/// see or act on the problem. Instead the host starts, the failure is recorded here, and every
/// request is diverted to a page that explains it. Once the DBA has run the supplied SQL, the
/// <c>Retry</c> action re-runs the check against this same instance and, if it now succeeds,
/// normal startup proceeds on the next request.
/// </para>
/// <para>
/// <b>Why there is a Preparing phase.</b> First-run initialisation is not instant — the database is
/// created, migrations are applied, seed data is written — and all of it used to happen before
/// <c>app.Run()</c>, so the port was not open yet and the browser simply hung on a blank tab. The
/// work now runs in the background while the host is already listening, and requests are answered
/// with a progress page. <see cref="Phase"/> is what the middleware switches on.
/// </para>
/// <para>
/// <b>Nothing secret is held.</b> The connection string is read from configuration each time rather
/// than cached, and the recorded result contains only the database name, the server name and the
/// identity of the process — all of which the page shows to the operator anyway.
/// </para>
/// </remarks>
public sealed class DatabaseSetupState
{
    private readonly IConfiguration _config;
    private readonly ILogger<DatabaseSetupState> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private DatabaseSetupResult? _lastFailure;
    private volatile DatabaseSetupPhase _phase = DatabaseSetupPhase.Preparing;

    public DatabaseSetupState(IConfiguration config, ILogger<DatabaseSetupState> log)
    {
        _config = config;
        _log = log;
    }

    /// <summary>
    /// Where the application is in its first-run sequence. Read on every request by the middleware,
    /// so writes to it are volatile and the order of the transitions below is the contract.
    /// </summary>
    /// <remarks>
    /// The sequence is always Preparing â†’ (Ready | Blocked). "Ready" means the database is reachable
    /// and initialisation finished; "Blocked" means a prerequisite is missing and only an operator
    /// can supply it. A blocked deployment can move to Ready through <see cref="RetryAsync"/> once
    /// the DBA has acted, and once Ready it never goes back â€” a transient blip must not take a
    /// running deployment offline.
    /// </remarks>
    public DatabaseSetupPhase Phase => _phase;

    /// <summary>
    /// True once the configured database has been reached successfully AND initialisation finished.
    /// Latches on: a deployment that has come up must never be pushed back to the setup page.
    /// </summary>
    public bool IsReady => _phase == DatabaseSetupPhase.Ready;

    /// <summary>
    /// True while first-run initialisation is still running. The middleware serves a progress page
    /// rather than blocking the request, which is the whole point of moving this off the startup path.
    /// </summary>
    public bool IsPreparing => _phase == DatabaseSetupPhase.Preparing;

    /// <summary>
    /// A human-readable description of the step in progress, shown on the progress page so a slow
    /// migration reads as work rather than as a hang. Written from the background initialiser.
    /// </summary>
    public string ProgressMessage { get; private set; } = "";

    /// <summary>The most recent failure, for the page to render. Null once <see cref="IsReady"/>.</summary>
    public DatabaseSetupResult? Failure =>
        _phase == DatabaseSetupPhase.Blocked ? _lastFailure : null;

    /// <summary>Publishes the step currently running, for the progress page.</summary>
    public void ReportProgress(string message)
    {
        ProgressMessage = message;
        _log.LogInformation("Startup: {Step}", message);
    }

    /// <summary>Records a failure detected during startup, moving the application to <c>Blocked</c>.</summary>
    public void RecordStartupFailure(DatabaseSetupResult result)
    {
        if (IsReady)
            return;

        _lastFailure = result;
        _phase = DatabaseSetupPhase.Blocked;
        _log.LogWarning(
            "Database is not ready ({Stage}): {Summary}", result.Stage, result.Summary);
    }

    /// <summary>Marks initialisation as complete, so normal requests are served from now on.</summary>
    public void MarkReady()
    {
        _lastFailure = null;
        ProgressMessage = "";
        _phase = DatabaseSetupPhase.Ready;
    }

    /// <summary>
    /// Runs the remaining initialisation after a successful retry. Assigned by the host at startup.
    /// </summary>
    /// <remarks>
    /// The initialiser is a one-shot task, so a retry that only re-tested the connection would leave
    /// the application stuck in <c>Preparing</c> with nothing working on it. The host hands the same
    /// initialisation body here, and <see cref="RetryAsync"/> invokes it once the check passes.
    /// </remarks>
    public Func<CancellationToken, Task>? ResumeInitialisation { get; set; }

    /// <summary>
    /// Re-runs the database check. Called by the operator's "try again" action after a DBA has
    /// created the login, the database or the user.
    /// </summary>
    /// <remarks>
    /// Only the connection check is repeated here, not the whole initialisation. On success the
    /// state returns to <c>Preparing</c> and <see cref="ResumeInitialisation"/> is invoked, so
    /// migrations and seed data run through exactly the same path as a normal start.
    /// </remarks>
    /// <returns>The result of the retry, for the page to render.</returns>
    public async Task<DatabaseSetupResult> RetryAsync(CancellationToken ct = default)
    {
        // One operator at a time. A retry is a handful of round-trips, but this page can be open in
        // several tabs and there is no reason to pile the checks up on the server.
        await _gate.WaitAsync(ct);
        try
        {
            if (IsReady)
                return DatabaseSetupResult.Ready(
                    _lastFailure?.DatabaseName ?? "", _lastFailure?.DataSource ?? "", _lastFailure?.Identity ?? "");

            var cs = _config.GetConnectionString("Default");
            if (string.IsNullOrWhiteSpace(cs))
            {
                var missing = new DatabaseSetupResult
                {
                    Stage = DatabaseSetupStage.ServerUnreachable,
                    Summary = "ConnectionStrings:Default is not configured in appsettings.json."
                };
                _lastFailure = missing;
                return missing;
            }

            var result = await DatabaseBootstrapService.EnsureDatabaseAsync(cs, _log, ct);
            if (!result.IsReady)
            {
                _lastFailure = result;
                _phase = DatabaseSetupPhase.Blocked;
                _log.LogWarning(
                    "Database check still failing after retry ({Stage}): {Summary}",
                    result.Stage, result.Summary);
                return result;
            }

            // The connection works now, but migrations and seed data have not run. Hand off to the
            // initialiser and return to Preparing, so the middleware serves the progress page again
            // and its poller follows through to the real site. Deliberately not awaited: this action
            // must respond so the browser can switch back to the progress page.
            _log.LogInformation("Database check succeeded on retry; resuming initialisation.");
            _lastFailure = null;
            _phase = DatabaseSetupPhase.Preparing;
            ProgressMessage = "در حال ادامهٔ راه‌اندازی سامانه…";

            var resume = ResumeInitialisation;
            if (resume is not null)
                _ = Task.Run(() => resume(CancellationToken.None));

            return result;
        }
        finally
        {
            _gate.Release();
        }
    }
}
