using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Infrastructure.Services;
using Morobot.Web.Services;

namespace Morobot.Web.Controllers;

/// <summary>Public marketing site (outside Panel area).</summary>
[AllowAnonymous]
public class HomeController : Controller
{
    private readonly SetupGuideService _setupGuide;
    private readonly ILocaleService _locale;
    private readonly DatabaseSetupState _dbSetup;
    private readonly LicenseService _license;
    private readonly SystemSettingsService _settings;
    private readonly IConfiguration _configuration;

    public HomeController(
        SetupGuideService setupGuide,
        ILocaleService locale,
        DatabaseSetupState dbSetup,
        LicenseService license,
        SystemSettingsService settings,
        IConfiguration configuration)
    {
        _setupGuide = setupGuide;
        _locale = locale;
        _dbSetup = dbSetup;
        _license = license;
        _settings = settings;
        _configuration = configuration;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        // The database check comes FIRST, before the front-page decision, and that order is load
        // bearing rather than a preference.
        //
        // The setup page is served on the front page, and DatabaseSetupMiddleware only lets "/"
        // through while the database is unusable. Redirecting "/" to the panel in that state sends
        // the request into a URL the middleware refuses, which bounces it straight back to "/" —
        // a redirect loop that never shows the operator the diagnosis. It would hit precisely the
        // panel-first installs, because those are the ones that redirect.
        //
        // There is also nothing to decide yet: the front-site switch lives in SystemSettings, which
        // during first-run initialisation has not been created. Asking for a branding/preference
        // value before the schema exists is how a settings read turns into a startup failure.
        if (!_dbSetup.IsReady)
            return View("~/Views/Setup/Database.cshtml", _dbSetup.Failure);

        // Only now is it safe — and meaningful — to ask which surface this deployment opens with.
        // The front-end package decides the default page, so an install that has not bought it must
        // not present the public site first.
        //
        // The panel controller sends an authenticated user straight on to their own home, and an
        // anonymous one to the sign-in form, so a panel-first install simply reads "panel-first".
        if (!await ShowsFrontPageAsync(ct))
            return RedirectToAction("Index", "Home", new { area = "Panel" });

        // A deployment whose database is not reachable must say so on the front page, not only on a
        // separate setup URL. An operator who opens the site sees the problem, the identity the
        // process runs as, and the SQL that fixes it — without having been told a path to visit.
        // The middleware reaches this action only for loopback callers; everyone else is stopped
        // before the controller with a bare 503.
        ViewData["Title"] = null;
        return View();
    }

    /// <summary>
    /// Whether opening the site should present the public front page, rather than sending the
    /// visitor to the panel.
    /// </summary>
    /// <remarks>
    /// Two independent gates, and BOTH must allow it:
    /// <list type="number">
    /// <item>the signed licence must carry the front-end package (<c>AllowFrontPackage</c>), which is
    /// what the vendor sold, and</item>
    /// <item>the administrator's own switch (<c>FrontShowSite</c>) must be on, which is what the
    /// deployment's owner decided.</item>
    /// </list>
    /// Keeping them separate means a licence upgrade cannot publish a public site the owner never
    /// asked for, and a setting cannot conjure the package into existence. The
    /// <c>Front:ShowFrontPageAsDefault</c> configuration key is an operator override that outranks
    /// both, for staging a site before its licence arrives.
    /// <para>
    /// A malformed or missing value must never break the front page, hence the try/catch — the site
    /// stays up and falls back to the panel, which is the safe direction because the panel is always
    /// part of the product.
    /// <para>
    /// Callers must only reach this once <see cref="DatabaseSetupState.IsReady"/> is true: it reads
    /// <c>SystemSettings</c>, which does not exist yet during first-run initialisation. The try/catch
    /// keeps a pre-initialisation call from throwing, but it would answer "panel-first" and produce
    /// the redirect loop documented on the caller — so this is a precondition, not a nicety.
    /// </para>
    /// </remarks>
    private async Task<bool> ShowsFrontPageAsync(CancellationToken ct)
    {
        var configured = _configuration.GetValue<bool?>("Front:ShowFrontPageAsDefault");
        if (configured is not null)
            return configured.Value;

        try
        {
            if (!await _license.IsFrontPackageEnabledAsync(ct))
                return false;

            var raw = await _settings.GetAsync(
                Morobot.Domain.SystemSettingKeys.FrontShowSite, "false", ct);

            return raw is "true" or "True" or "1" or "on" or "yes";
        }
        catch
        {
            return false;
        }
    }

    [HttpGet]
    public async Task<IActionResult> SetupGuide(CancellationToken ct)
    {
        var doc = await _setupGuide.LoadAsync(ct);
        // Brand is appended by the view; keep the page title itself brand-free.
        ViewData["Title"] = _locale["setupGuide.title"];
        if (doc is null)
            return View("SetupGuideMissing");

        return View(doc);
    }

    [HttpGet]
    public async Task<IActionResult> SetupGuideDownload(CancellationToken ct)
    {
        var doc = await _setupGuide.LoadAsync(ct);
        if (doc is null)
            return NotFound();

        return File(System.Text.Encoding.UTF8.GetBytes(doc.RawMarkdown), "text/markdown; charset=utf-8", "setup-guide.md");
    }

    [HttpGet]
    public IActionResult Error() => View();
}
