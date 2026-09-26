using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Domain.Enums;

namespace Morobot.Web.Areas.Panel.Controllers;

[Area("Panel")]
[Authorize]
public class HomeController : Controller
{
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
}
