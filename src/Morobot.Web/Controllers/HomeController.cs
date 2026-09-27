using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Web.Services;

namespace Morobot.Web.Controllers;

/// <summary>Public marketing site (outside Panel area).</summary>
[AllowAnonymous]
public class HomeController : Controller
{
    private readonly SetupGuideService _setupGuide;
    private readonly ILocaleService _locale;
    private readonly DatabaseSetupState _dbSetup;

    public HomeController(
        SetupGuideService setupGuide, ILocaleService locale, DatabaseSetupState dbSetup)
    {
        _setupGuide = setupGuide;
        _locale = locale;
        _dbSetup = dbSetup;
    }

    [HttpGet]
    public IActionResult Index()
    {
        ViewData["Title"] = null;

        // A deployment whose database is not reachable must say so on the front page, not only on a
        // separate setup URL. An operator who opens the site sees the problem, the identity the
        // process runs as, and the SQL that fixes it — without having been told a path to visit.
        // The middleware reaches this action only for loopback callers; everyone else is stopped
        // before the controller with a bare 503.
        if (!_dbSetup.IsReady)
            return View("~/Views/Setup/Database.cshtml", _dbSetup.Failure);

        return View();
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
