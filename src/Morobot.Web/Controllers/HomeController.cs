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

    public HomeController(SetupGuideService setupGuide, ILocaleService locale)
    {
        _setupGuide = setupGuide;
        _locale = locale;
    }

    [HttpGet]
    public IActionResult Index()
    {
        ViewData["Title"] = null;
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
