using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

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
    public IActionResult Templates()
    {
        ViewData["Title"] = "قالب‌ها";
        return View();
    }
}
