using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Web.Services;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class HomeController : Controller
{
    private readonly ILocaleService _locale;
    public HomeController(ILocaleService locale) => _locale = locale;

    public IActionResult Index()
    {
        ViewData["Title"] = _locale["admin.dashboard.title"];
        return View();
    }
}
