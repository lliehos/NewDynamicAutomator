using Webautomator.Infrastructure.Persistence;
using Webautomator.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Webautomator.Web.Services;

namespace Webautomator.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class MigrateController : Controller
{
    /// <summary>Form field naming the plan a legacy user's NEW account should be created on.</summary>
    internal const string NewUserPlanPrefix = "newPlan_";

    private readonly LegacyImportService _import;
    private readonly ILocaleService _locale;
    private readonly LicenseService _license;
    private readonly AppDbContext _db;

    public MigrateController(LegacyImportService import, ILocaleService locale, LicenseService license, AppDbContext db)
    {
        _import = import;
        _locale = locale;
        _license = license;
        _db = db;
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
        // The review step is where the plan for each NEW account is chosen, because this page already
        // lists exactly the users whose processes are about to be transferred and marks the ones that
        // match an existing account. Without plan management there is nothing to choose — each new
        // account lands on the deployment's top plan.
        await FillPlansAsync(ct);
        return View("Preprocess");
    }

    /// <summary>Transfer the selected processes (each to its own owner; duplicates refused server-side).</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> RunProcesses(
        string connectionString, int[]? taskIds, IFormCollection form, CancellationToken ct)
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

        var report = await _import.ImportProcessesAsync(
            connectionString, taskIds, ReadNewUserPlans(form), ct);
        ViewBag.Report = report;
        return View("Result");
    }

    /// <summary>
    /// The plan chosen for each legacy user's new account, read from the review form. Returns null
    /// when the page offered no choice (no plan management), which tells the import to place new
    /// accounts on the deployment's top plan.
    /// </summary>
    private static Dictionary<int, int>? ReadNewUserPlans(IFormCollection form)
    {
        Dictionary<int, int>? map = null;
        foreach (var key in form.Keys)
        {
            if (!key.StartsWith(NewUserPlanPrefix, StringComparison.OrdinalIgnoreCase)) continue;
            if (!int.TryParse(key[NewUserPlanPrefix.Length..], out var legacyUserId)) continue;
            if (!int.TryParse(form[key].LastOrDefault(), out var planId)) continue;
            map ??= new Dictionary<int, int>();
            map[legacyUserId] = planId;
        }
        return map;
    }

    /// <summary>
    /// Load the plans a new migrated account may be created on. Nothing is offered when the licence
    /// has no plan management: the import then places every new account on the top plan.
    /// </summary>
    private async Task FillPlansAsync(CancellationToken ct)
    {
        var allowsPlanManagement = (await _license.GetRuntimeStateAsync(ct)).AllowsPlanManagement;
        ViewBag.AllowsPlanManagement = allowsPlanManagement;
        ViewBag.Plans = allowsPlanManagement
            ? await _db.Plans.AsNoTracking().Where(p => p.IsActive).OrderBy(p => p.SortOrder).ToListAsync(ct)
            : new List<Webautomator.Domain.Entities.Plan>();
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

        var (user, process, groups, sources, error) = await _import.ListProcessDetailsAsync(connectionString, taskId, ct);
        if (user is null || process is null || groups is null || sources is null)
        {
            ViewBag.Error = error ?? _locale["admin.migrate.connectFailed"];
            ViewBag.ConnectionString = connectionString;
            return View("Index");
        }

        ViewBag.ConnectionString = connectionString;
        ViewBag.LegacyUser = user;
        ViewBag.Process = process;
        ViewBag.Groups = groups;
        ViewBag.Sources = sources;
        ViewBag.UserIds = userIds ?? Array.Empty<int>();
        return View("ProcessDetails");
    }
}
