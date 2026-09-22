using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Areas.Panel.Controllers;

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
}
