using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Controllers;

[Authorize]
public class RecordController : Controller
{
    [HttpGet]
    public IActionResult Index()
    {
        return View();
    }
}
