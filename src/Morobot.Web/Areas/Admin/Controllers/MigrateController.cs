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

    /// <summary>
    /// Process-selection step: every selected user with the processes that user OWNS
    /// (Tasks.CreatorUserId), grouped by user. Shared (User_Tasks) processes are never listed —
    /// the transfer is creator-only, so the list shows exactly what a transfer would bring over.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Processes(string connectionString, int[]? userIds, CancellationToken ct)
    {
        if (!await IsMigrationAllowedAsync(ct)) return MigrationNotAllowed();
        ViewData["Title"] = _locale["admin.migrate.processesTitle"];
        connectionString = (connectionString ?? "").Trim();
        userIds ??= Array.Empty<int>();
        if (string.IsNullOrWhiteSpace(connectionString) || userIds.Length == 0)
        {
            ViewBag.Error = _locale["admin.migrate.needConnectionAndUser"];
            return View("Index");
        }

        var (groups, error) = await _import.ListProcessesForUsersAsync(connectionString, userIds, ct);
        if (groups is null)
        {
            ViewBag.Error = error ?? _locale["admin.migrate.connectFailed"];
            ViewBag.ConnectionString = connectionString;
            return View("Index");
        }

        ViewBag.ConnectionString = connectionString;
        ViewBag.Groups = groups;
        ViewBag.UserIds = userIds;
        return View("Processes");
    }

    /// <summary>
    /// Pre-transfer review: the selected processes grouped by user, where anything the automatic
    /// conversion cannot settle would be decided by the operator. Currently a review page; the
    /// decision items are filled in as the converter's diagnostics are built out.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Preprocess(
        string connectionString, int[]? userIds, int[]? taskIds, CancellationToken ct)
    {
        if (!await IsMigrationAllowedAsync(ct)) return MigrationNotAllowed();
        ViewData["Title"] = _locale["admin.migrate.preprocessTitle"];
        connectionString = (connectionString ?? "").Trim();
        userIds ??= Array.Empty<int>();
        taskIds ??= Array.Empty<int>();
        if (string.IsNullOrWhiteSpace(connectionString) || userIds.Length == 0 || taskIds.Length == 0)
        {
            ViewBag.Error = _locale["admin.migrate.needProcessSelection"];
            return View("Index");
        }

        var (groups, error) = await _import.ListProcessesForUsersAsync(connectionString, userIds, ct);
        if (groups is null)
        {
            ViewBag.Error = error ?? _locale["admin.migrate.connectFailed"];
            ViewBag.ConnectionString = connectionString;
            return View("Index");
        }

        ViewBag.ConnectionString = connectionString;
        ViewBag.Groups = groups;
        ViewBag.UserIds = userIds;
        ViewBag.SelectedTaskIds = new HashSet<int>(taskIds);
        return View("Preprocess");
    }

    /// <summary>Transfer the selected processes (each to its own owner; duplicates refused server-side).</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> RunProcesses(string connectionString, int[]? taskIds, CancellationToken ct)
    {
        if (!await IsMigrationAllowedAsync(ct)) return MigrationNotAllowed();
        ViewData["Title"] = _locale["admin.migrate.resultTitle"];
        connectionString = (connectionString ?? "").Trim();
        taskIds ??= Array.Empty<int>();
        if (string.IsNullOrWhiteSpace(connectionString) || taskIds.Length == 0)
        {
            ViewBag.Error = _locale["admin.migrate.needProcessSelection"];
            return View("Index");
        }

        var report = await _import.ImportProcessesAsync(connectionString, taskIds, ct);
        ViewBag.Report = report;
        return View("Result");
    }

    /// <summary>
    /// Read-only details of ONE legacy process (groups and steps), so the admin can inspect the
    /// shape of what a transfer would convert. The owner is resolved from the task itself.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ProcessDetails(
        string connectionString, int taskId, int[]? userIds, CancellationToken ct)
    {
        if (!await IsMigrationAllowedAsync(ct)) return MigrationNotAllowed();
        ViewData["Title"] = _locale["admin.migrate.detailsTitle"];
        connectionString = (connectionString ?? "").Trim();
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            ViewBag.Error = _locale["admin.migrate.needConnection"];
            return View("Index");
        }

        var (user, process, groups, error) = await _import.ListProcessDetailsAsync(connectionString, taskId, ct);
        if (user is null || process is null || groups is null)
        {
            ViewBag.Error = error ?? _locale["admin.migrate.connectFailed"];
            ViewBag.ConnectionString = connectionString;
            return View("Index");
        }

        ViewBag.ConnectionString = connectionString;
        ViewBag.LegacyUser = user;
        ViewBag.Process = process;
        ViewBag.Groups = groups;
        ViewBag.UserIds = userIds ?? Array.Empty<int>();
        return View("ProcessDetails");
    }
}
