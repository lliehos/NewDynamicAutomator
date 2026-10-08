using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Webautomator.Domain.Enums;

namespace Webautomator.Web.Areas.Panel.Controllers;

[Area("Panel")]
[Authorize]
public class HomeController : Controller
{
    private readonly IConfiguration _configuration;

    public HomeController(IConfiguration configuration) => _configuration = configuration;

    public IActionResult Index()
    {
        ViewData["Title"] = "صفحه اصلی";
        return View();
    }

    public IActionResult Processes()
    {
        // Tasks are listed from browser localStorage / extension (local-first).
        ViewData["Title"] = "فرآیندها";
        return View();
    }

    public IActionResult DataSources()
    {
        ViewData["Title"] = "منابع";
        // The "create public source" button is shown only to the roles the API lets create one, so
        // the page never offers a control that would come back 400. The API re-checks the role — this
        // only decides whether the button is drawn.
        ViewBag.CanCreatePublicSource =
            User.IsInRole(nameof(UserRole.Admin)) || User.IsInRole(nameof(UserRole.ProcessManager));
        return View();
    }

    /// <summary>
    /// Template management. The list itself is fetched from /api/templates by the page, so this
    /// only renders the shell — the same split the processes page uses.
    /// </summary>
    /// <remarks>
    /// Gated on the same role the sidebar entry uses. Hiding the menu item alone was not enough:
    /// anyone could reach the page by typing the URL, and the page is the one place templates are
    /// published to every process. The API checks the role too, so this is the matching view-level
    /// half rather than the only guard.
    /// </remarks>
    public IActionResult Templates()
    {
        if (!User.IsInRole(nameof(UserRole.Admin)) && !User.IsInRole(nameof(UserRole.ProcessManager)))
            return Forbid();
        ViewData["Title"] = "قالب‌ها";
        return View();
    }

    /// <summary>
    /// The illustrated user guide: one section per panel page, in the order a new user meets them.
    /// </summary>
    /// <remarks>
    /// Content lives in the locale files (<c>panel.guide.*</c>) rather than in the view, so the page
    /// is bilingual like the rest of the panel and a wording change does not touch markup. The
    /// screenshot for each section is looked up from the <c>Guide.shots</c> configuration list, so
    /// an operator can re-shoot a page and drop in new files without editing this code — and a
    /// section whose image is missing renders a labelled placeholder instead of a broken image.
    /// </remarks>
    public IActionResult Guide()
    {
        ViewData["Title"] = "راهنمای استفاده";
        ViewData["GuideShots"] = _configuration
            .GetSection("Guide:Shots").Get<string[]>() ?? [];
        return View();
    }
}
