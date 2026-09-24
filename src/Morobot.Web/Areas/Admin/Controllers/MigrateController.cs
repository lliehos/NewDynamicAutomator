using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Web.Services;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class MigrateController : Controller
{
    private readonly LegacyImportService _import;
    private readonly ILocaleService _locale;
    private readonly LicenseService _license;

    public MigrateController(LegacyImportService import, ILocaleService locale, LicenseService license)
    {
        _import = import;
        _locale = locale;
        _license = license;
    }

    /// <summary>
    /// "Migrate from legacy database" is a vendor-authorised operation. The licence
    /// must carry <c>AllowLegacyMigration</c>, otherwise the whole feature is hidden
    /// (GET) and refused (POST) — a buyer cannot enable it themselves.
    /// </summary>
    private async Task<bool> IsMigrationAllowedAsync(CancellationToken ct)
        => (await _license.GetRuntimeStateAsync(ct)).AllowsLegacyMigration;

    private IActionResult MigrationNotAllowed() => NotFound();

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        if (!await IsMigrationAllowedAsync(ct)) return MigrationNotAllowed();
        ViewData["Title"] = _locale["admin.migrate.title"];
        return View();
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Connect(string connectionString, CancellationToken ct)
    {
        if (!await IsMigrationAllowedAsync(ct)) return MigrationNotAllowed();
        ViewData["Title"] = _locale["admin.migrate.title"];
        connectionString = (connectionString ?? "").Trim();
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            ViewBag.Error = _locale["admin.migrate.needConnection"];
            return View("Index");
        }

        var (users, error) = await _import.ListUsersAsync(connectionString, ct);
        if (users is null)
        {
            ViewBag.Error = error ?? _locale["admin.migrate.connectFailed"];
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
        if (!await IsMigrationAllowedAsync(ct)) return MigrationNotAllowed();
        ViewData["Title"] = _locale["admin.migrate.resultTitle"];
        connectionString = (connectionString ?? "").Trim();
        userIds ??= Array.Empty<int>();
        if (string.IsNullOrWhiteSpace(connectionString) || userIds.Length == 0)
        {
            TempData["Ok"] = null;
            ViewBag.Error = _locale["admin.migrate.needConnectionAndUser"];
            return View("Index");
        }

        var report = await _import.ImportUsersAsync(connectionString, userIds, ct);
        ViewBag.Report = report;
        return View("Result");
    }
}
