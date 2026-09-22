using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Controllers;

/// <summary>Public marketing site (outside Panel area).</summary>
[AllowAnonymous]
public class HomeController : Controller
{
    [HttpGet]
    public IActionResult Index()
    {
        ViewData["Title"] = "مروبات — اتوماسیون هوشمند فرآیندهای وب";
        return View();
    }

    [HttpGet]
    public IActionResult Error() => View();
}
