using System.Security.Claims;
using DynamicAutomator.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Controllers;

[Authorize]
public class HomeController : Controller
{
    private readonly TaskService _tasks;

    public HomeController(TaskService tasks) => _tasks = tasks;

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var tasks = await _tasks.ListForUserAsync(userId, ct);
        return View(tasks);
    }

    [AllowAnonymous]
    public IActionResult Error() => View();
}
