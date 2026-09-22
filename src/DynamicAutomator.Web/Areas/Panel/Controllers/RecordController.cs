using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Areas.Panel.Controllers;

[Area("Panel")]
[Authorize]
public class RecordController : Controller
{
    [HttpGet]
    public IActionResult Index()
    {
        return View();
    }
}
