using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class MigrateController : Controller
{
    private readonly LegacyImportService _import;

    public MigrateController(LegacyImportService import) => _import = import;

    [HttpGet]
    public IActionResult Index()
    {
        ViewData["Title"] = "انتقال از دیتابیس قدیمی";
        return View();
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Connect(string connectionString, CancellationToken ct)
    {
        ViewData["Title"] = "انتقال از دیتابیس قدیمی";
        connectionString = (connectionString ?? "").Trim();
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            ViewBag.Error = "Connection string لازم است.";
            return View("Index");
        }

        var (users, error) = await _import.ListUsersAsync(connectionString, ct);
        if (users is null)
        {
            ViewBag.Error = error ?? "اتصال ناموفق بود.";
            ViewBag.ConnectionString = connectionString;
            return View("Index");
        }

        ViewBag.ConnectionString = connectionString;
        ViewBag.Users = users;
        return View("SelectUsers");
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Run(string connectionString, int[]? userIds, CancellationToken ct)
    {
        ViewData["Title"] = "نتیجه انتقال";
        connectionString = (connectionString ?? "").Trim();
        userIds ??= Array.Empty<int>();
        if (string.IsNullOrWhiteSpace(connectionString) || userIds.Length == 0)
        {
            TempData["Ok"] = null;
            ViewBag.Error = "اتصال و حداقل یک کاربر لازم است.";
            return View("Index");
        }

        var report = await _import.ImportUsersAsync(connectionString, userIds, ct);
        ViewBag.Report = report;
        return View("Result");
    }
}
