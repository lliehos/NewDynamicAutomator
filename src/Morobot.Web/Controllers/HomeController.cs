using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Web.Services;

namespace Morobot.Web.Controllers;

/// <summary>Public marketing site (outside Panel area).</summary>
[AllowAnonymous]
public class HomeController : Controller
{
    private readonly SetupGuideService _setupGuide;

    public HomeController(SetupGuideService setupGuide) => _setupGuide = setupGuide;

    [HttpGet]
    public IActionResult Index()
    {
        ViewData["Title"] = "مروبات — اتوماسیون هوشمند فرآیندهای وب";
        return View();
    }

    [HttpGet]
    public async Task<IActionResult> SetupGuide(CancellationToken ct)
    {
        var doc = await _setupGuide.LoadAsync(ct);
        if (doc is null)
        {
            ViewData["Title"] = "راهنمای راه‌اندازی Morobot";
            return View("SetupGuideMissing");
        }

        ViewData["Title"] = "راهنمای راه‌اندازی Morobot";
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
