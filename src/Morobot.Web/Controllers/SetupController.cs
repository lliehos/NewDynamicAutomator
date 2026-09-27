using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Web.Services;

namespace Morobot.Web.Controllers;

/// <summary>
/// The one page an operator sees when the application cannot reach its database.
/// </summary>
/// <remarks>
/// Anonymous and outside the normal authentication path on purpose: this is the state in which
/// there is no database to sign in against, so requiring a session would make the page unreachable
/// exactly when it is needed. The middleware guards it to loopback instead — see
/// <see cref="Middleware.DatabaseSetupMiddleware"/>.
/// </remarks>
[AllowAnonymous]
public class SetupController : Controller
{
    private readonly DatabaseSetupState _state;

    public SetupController(DatabaseSetupState state) => _state = state;

    /// <summary>Shows what is missing and the SQL that fixes it.</summary>
    [HttpGet("/setup/database")]
    public IActionResult Database()
    {
        if (_state.IsReady)
            return Redirect("/");

        ViewData["Title"] = "Database setup";
        return View(_state.Failure);
    }

    /// <summary>
    /// Re-runs the check after the DBA has made the change, then returns to the page.
    /// </summary>
    /// <remarks>
    /// A POST so a browser prefetch or a refresh cannot silently re-test, and a redirect back to the
    /// page afterwards so a refresh shows the result rather than reposting. No restart is involved:
    /// the check runs against the same live process, which is the whole point of the page.
    /// </remarks>
    [HttpPost("/setup/database/retry")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Retry(CancellationToken ct)
    {
        var result = await _state.RetryAsync(ct);

        if (result.IsReady)
        {
            // The connection now works, so the initialiser has been handed the remaining work and
            // the state is Preparing again. Send the browser there, not to the setup page — the
            // progress page polls /setup/status and will follow through to the real site on its own.
            return Redirect("/");
        }

        TempData["SetupRetryFailed"] = true;
        return Redirect("/setup/database");
    }
}
