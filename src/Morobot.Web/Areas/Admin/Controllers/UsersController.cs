using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Domain;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class UsersController : Controller
{
    private readonly AppDbContext _db;
    private readonly EventLogService _events;
    private readonly PlaySessionTracker _plays;
    private readonly LicenseService _license;
    private readonly DeploymentBindingService _deploymentBinding;
    private readonly SystemSettingsService _settings;
    private readonly TaskService _tasks;
    private readonly ILocaleService _locale;
    private readonly EntitlementService _entitlements;
    private readonly PasswordHasher<AppUser> _hasher = new();

    public UsersController(
        AppDbContext db,
        EventLogService events,
        PlaySessionTracker plays,
        LicenseService license,
        DeploymentBindingService deploymentBinding,
        SystemSettingsService settings,
        TaskService tasks,
        ILocaleService locale,
        EntitlementService entitlements)
    {
        _db = db;
        _events = events;
        _plays = plays;
        _license = license;
        _deploymentBinding = deploymentBinding;
        _settings = settings;
        _tasks = tasks;
        _locale = locale;
        _entitlements = entitlements;
    }

    /// <summary>
    /// Whether the licence lets this deployment define plan levels. When it does not, no page can
    /// edit a plan and every user resolves to the top one, so the plan fields are not offered and
    /// the deployment-wide password policy takes over from the (unreachable) per-plan rule.
    /// </summary>
    private async Task<bool> AllowsPlanManagementAsync(CancellationToken ct)
        => (await _license.GetRuntimeStateAsync(ct)).AllowsPlanManagement;

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var users = await _db.Users.AsNoTracking()
            .Include(u => u.Plan)
            .OrderBy(u => u.UserName)
            .ToListAsync(ct);
        var lastSeen = await _events.GetLastSeenByUserAsync(ct);
        var playingIds = _plays.ListPlaying()
            .Where(p => p.UserId is > 0)
            .Select(p => p.UserId!.Value)
            .ToHashSet();
        ViewBag.LastSeenByUserId = lastSeen;
        ViewBag.PlayingUserIds = playingIds;
        // Ownership counts per user. AppUser has CreatedProcesses (not Processes) and no
        // DataSources navigation, so both are grouped projections over the owner column.
        ViewBag.ProcessCountByUserId = await _db.Processes.AsNoTracking()
            .Where(p => p.CreatorUserId != null)
            .GroupBy(p => p.CreatorUserId!.Value)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.UserId, x => x.Count, ct);
        ViewBag.SourceCountByUserId = await _db.DataSources.AsNoTracking()
            .GroupBy(d => d.OwnerUserId)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.UserId, x => x.Count, ct);
        return View(users);
    }

    [HttpGet]
    public async Task<IActionResult> Create(CancellationToken ct)
    {
        await FillPlans(ct);
        return View(new AppUser { IsActive = true, Role = UserRole.User });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(string userName, string password, string? firstName, string? lastName,
        string? email, string? nationalId, int? planId, UserRole role = UserRole.User, bool isActive = true,
        CancellationToken ct = default)
    {
        userName = (userName ?? "").Trim();
        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(password))
        {
            TempData["Ok"] = "Username and password required.";
            await FillPlans(ct);
            return View(new AppUser
            {
                UserName = userName, FirstName = firstName, LastName = lastName,
                Email = email, NationalId = nationalId, PlanId = planId, Role = role, IsActive = isActive
            });
        }

        if (ReservedUserNames.IsReserved(userName))
        {
            ModelState.AddModelError(nameof(userName), "This username is reserved.");
            await FillPlans(ct);
            return View(new AppUser
            {
                UserName = userName, FirstName = firstName, LastName = lastName,
                Email = email, NationalId = nationalId, PlanId = planId, Role = role, IsActive = isActive
            });
        }

        if (await _db.Users.AnyAsync(u => u.UserName == userName, ct))
        {
            ModelState.AddModelError(nameof(userName), "Username already exists.");
            await FillPlans(ct);
            return View(new AppUser
            {
                UserName = userName, FirstName = firstName, LastName = lastName,
                Email = email, NationalId = nationalId, PlanId = planId, Role = role, IsActive = isActive
            });
        }

        var allowsPlans = await AllowsPlanManagementAsync(ct);
        Plan? plan = null;
        // A plan posted by a crafted form is ignored when plans are not managed: the account then
        // starts on the deployment's top plan, which is exactly what the resolver would report.
        if (allowsPlans && planId is int pid)
            plan = await _db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == pid, ct);
        // Without plan management the account starts on the deployment's top plan, which is what the
        // entitlement resolver would report for it anyway; with it, an unset plan falls back to Free.
        plan ??= allowsPlans
            ? await _db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Code == nameof(PlanCode.Free), ct)
            : await _entitlements.FindTopPlanAsync(ct);
        plan ??= await _db.Plans.AsNoTracking().FirstAsync(p => p.Code == nameof(PlanCode.Free), ct);

        var (globalMinLen, globalComplexity) = await _settings.GetGlobalPasswordPolicyAsync(ct);
        var (pwdOk, pwdErr) = PasswordPolicy.Validate(
            password, allowsPlans ? plan : null, globalMinLen, globalComplexity);
        if (!pwdOk)
        {
            ModelState.AddModelError(nameof(password), pwdErr ?? "Invalid password");
            await FillPlans(ct);
            return View(new AppUser
            {
                UserName = userName, FirstName = firstName, LastName = lastName,
                Email = email, NationalId = nationalId, PlanId = planId, Role = role, IsActive = isActive
            });
        }

        if (isActive)
        {
            try
            {
                await _license.EnsureCanAddActiveUserAsync(ct);
            }
            catch (InvalidOperationException ex) when (ex.Message.StartsWith("license.error.", StringComparison.Ordinal))
            {
                TempData["Ok"] = ex.Message.Split(':')[0];
                await FillPlans(ct);
                return View(new AppUser
                {
                    UserName = userName, FirstName = firstName, LastName = lastName,
                    Email = email, NationalId = nationalId, PlanId = planId, Role = role, IsActive = isActive
                });
            }
        }

        var user = new AppUser
        {
            UserName = userName,
            FirstName = firstName,
            LastName = lastName,
            Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim(),
            NationalId = string.IsNullOrWhiteSpace(nationalId) ? null : nationalId.Trim(),
            PlanId = plan.Id,
            Role = role,
            IsActive = isActive,
            CreatedAtUtc = DateTime.UtcNow
        };
        user.PasswordHash = _hasher.HashPassword(user, password);
        await _deploymentBinding.StampUserAsync(user, ct);
        _db.Users.Add(user);
        await _db.SaveChangesAsync(ct);
        TempData["Ok"] = "User created.";
        return RedirectToAction(nameof(Index));
    }

    [HttpGet]
    public async Task<IActionResult> Edit(int id, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return NotFound();
        await FillPlans(ct);
        return View(user);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Edit(int id, int? planId, UserRole role, bool isActive = false,
        string? firstName = null, string? lastName = null, string? email = null, string? nationalId = null,
        string? newPassword = null, CancellationToken ct = default)
    {
        var user = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return NotFound();

        var allowsPlans = await AllowsPlanManagementAsync(ct);

        Plan? targetPlan = user.Plan;
        if (allowsPlans && planId is int pid)
            targetPlan = await _db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == pid, ct)
                         ?? targetPlan;
        targetPlan ??= await _db.Plans.AsNoTracking().FirstAsync(p => p.Code == nameof(PlanCode.Free), ct);

        var (globalMinLen, globalComplexity) = await _settings.GetGlobalPasswordPolicyAsync(ct);
        // A plan move only exists when plans are managed; without them the password rule is the
        // global one and there is no stricter plan to move to, so the "changing plan needs a new
        // password" rule must not fire.
        var wasStrict = PasswordPolicy.IsStrict(allowsPlans ? user.Plan : null, globalMinLen, globalComplexity);
        var needsStrict = PasswordPolicy.IsStrict(allowsPlans ? targetPlan : null, globalMinLen, globalComplexity);

        if (allowsPlans && needsStrict && !wasStrict && string.IsNullOrWhiteSpace(newPassword))
        {
            ModelState.AddModelError(nameof(newPassword), "Target plan requires a new password matching its policy.");
            await FillPlans(ct);
            user.FirstName = firstName;
            user.LastName = lastName;
            user.Email = email;
            user.NationalId = nationalId;
            user.PlanId = planId;
            user.Role = role;
            user.IsActive = isActive;
            return View(user);
        }

        if (!string.IsNullOrWhiteSpace(newPassword))
        {
            var (pwdOk, pwdErr) = PasswordPolicy.Validate(
                newPassword, allowsPlans ? targetPlan : null, globalMinLen, globalComplexity);
            if (!pwdOk)
            {
                ModelState.AddModelError(nameof(newPassword), pwdErr ?? "Invalid password");
                await FillPlans(ct);
                user.FirstName = firstName;
                user.LastName = lastName;
                user.Email = email;
                user.NationalId = nationalId;
                user.PlanId = planId;
                user.Role = role;
                user.IsActive = isActive;
                return View(user);
            }
            user.PasswordHash = _hasher.HashPassword(user, newPassword);
        }

        if (isActive && !user.IsActive)
        {
            try
            {
                await _license.EnsureCanActivateUserAsync(1, ct);
            }
            catch (InvalidOperationException ex) when (ex.Message.StartsWith("license.error.", StringComparison.Ordinal))
            {
                TempData["Ok"] = ex.Message.Split(':')[0];
                await FillPlans(ct);
                return View(user);
            }
        }

        user.FirstName = string.IsNullOrWhiteSpace(firstName) ? null : firstName.Trim();
        user.LastName = string.IsNullOrWhiteSpace(lastName) ? null : lastName.Trim();
        user.Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
        user.NationalId = string.IsNullOrWhiteSpace(nationalId) ? null : nationalId.Trim();
        // Only write the plan when it is managed: the field is hidden without the licence, so the
        // POST carries nothing and assigning it would clear the stored plan on every edit.
        if (allowsPlans) user.PlanId = planId;
        user.Role = role;
        user.IsActive = isActive;
        await _db.SaveChangesAsync(ct);
        TempData["Ok"] = "Saved.";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Removes a user together with everything that belongs to them.</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return NotFound();

        var refusal = await DeleteUserCoreAsync(user, ct);
        TempData["Ok"] = _locale[refusal ?? "admin.users.deleted"];
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Delete the rows the admin ticked in the list. Each account goes through the same
    /// <see cref="DeleteUserCoreAsync"/> as the single delete, so the two deliberate refusals (the
    /// acting admin, the last active administrator) still hold — they are reported instead of
    /// being silently dropped.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteMany(int[] ids, CancellationToken ct)
    {
        var deleted = 0;
        var skipped = 0;
        foreach (var id in (ids ?? Array.Empty<int>()).Distinct())
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
            if (user is null) continue;
            if (await DeleteUserCoreAsync(user, ct) is null) deleted++;
            else skipped++;
        }

        if (skipped > 0)
        {
            TempData["Warn"] = _locale.T("admin.users.deleteManySkipped",
                ("deleted", deleted.ToString()), ("skipped", skipped.ToString()));
        }
        else if (deleted > 0)
        {
            TempData["Ok"] = _locale.T("admin.users.deletedMany", ("count", deleted.ToString()));
        }
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Removes a user together with everything that belongs to them, or refuses with a reason.
    /// </summary>
    /// <remarks>
    /// The database cascades only part of this. <c>ProcessShares</c>, <c>DeviceSessions</c> and the
    /// user's own <c>DataSources</c> (and, through them, their cells) do cascade from the user row,
    /// but the two things an admin most expects to disappear do not:
    ///
    /// <list type="bullet">
    /// <item><description>
    /// <c>Processes.CreatorUserId</c> is <c>SetNull</c>, so their processes would survive as
    /// ownerless rows. Each one is removed explicitly — and, when a process is the "mother" of a
    /// template, through <see cref="TaskService.DeleteAsync"/> so the template goes with it and the
    /// children attached to that template are detached first (the <c>Process.TemplateId</c> relation
    /// is <c>Restrict</c> and would otherwise refuse the delete).
    /// </description></item>
    /// <item><description>
    /// <c>ProcessTemplates.CreatorUserId</c> is also <c>SetNull</c>, so templates the user published
    /// are removed explicitly. Children of those templates are already detached by the process
    /// delete above; any template authored from a process the user does not own is deleted here
    /// with the same detach-first treatment.
    /// </description></item>
    /// </list>
    ///
    /// Two refusals are deliberate rather than incidental:
    /// the acting admin cannot delete themselves (that would end the session mid-request), and the
    /// last active administrator cannot be deleted because doing so would lock every admin page —
    /// this one included — out of the system for good.
    /// </remarks>
    /// <returns>Null when the account was deleted, otherwise the locale key of the refusal.</returns>
    private async Task<string?> DeleteUserCoreAsync(AppUser user, CancellationToken ct)
    {
        if (user.Id == CurrentUserId) return "admin.users.deleteSelfBlocked";

        if (user.Role == UserRole.Admin && user.IsActive)
        {
            var otherActiveAdmins = await _db.Users
                .CountAsync(u => u.Id != user.Id && u.Role == UserRole.Admin && u.IsActive, ct);
            if (otherActiveAdmins == 0) return "admin.users.deleteLastAdminBlocked";
        }

        var userName = user.UserName;

        // Linked sources are Restrict on the DataSource side, so the join rows have to go before the
        // source rows, and they have to go before the PROCESSES too: deleting a process cascades its
        // own ProcessDataSources, which would otherwise collide with the Restrict rule.
        var linkedSourceIds = await _db.ProcessDataSources
            .Where(l => l.DataSource.OwnerUserId == user.Id)
            .Select(l => l.DataSourceId)
            .Distinct()
            .ToListAsync(ct);
        if (linkedSourceIds.Count > 0)
        {
            await _db.ProcessDataSources
                .Where(l => linkedSourceIds.Contains(l.DataSourceId))
                .ExecuteDeleteAsync(ct);
        }

        // Their processes, via the shared delete so a mother takes its template with it.
        var ownedProcessIds = await _db.Processes
            .Where(p => p.CreatorUserId == user.Id)
            .Select(p => p.Id)
            .ToListAsync(ct);
        foreach (var processId in ownedProcessIds)
            await _tasks.DeleteAsync(processId, ct);

        // A template the user published from somebody else's process: cut its children loose first
        // (Process.TemplateId is Restrict), then drop it.
        var orphanTemplates = await _db.ProcessTemplates
            .Where(t => t.CreatorUserId == user.Id)
            .Select(t => t.Id)
            .ToListAsync(ct);
        foreach (var templateId in orphanTemplates)
        {
            var children = await _db.Processes.Where(p => p.TemplateId == templateId).ToListAsync(ct);
            foreach (var child in children)
            {
                child.TemplateId = null;
                child.TemplateVersion = null;
                child.UpdatedAtUtc = DateTime.UtcNow;
            }
            await _db.ProcessTemplates.Where(t => t.Id == templateId).ExecuteDeleteAsync(ct);
        }

        // Any process they were merely the last editor of, or that still points at them, must let go
        // of the id before the user row goes — these columns are SetNull, but the ids are held in
        // the change tracker and would otherwise be re-written by the same SaveChanges.
        await _db.Processes
            .Where(p => p.CreatorUserId == user.Id || p.LastEditorUserId == user.Id)
            .ExecuteUpdateAsync(s => s
                .SetProperty(p => p.CreatorUserId, (int?)null)
                .SetProperty(p => p.LastEditorUserId, (int?)null), ct);
        await _db.DataSources
            .Where(d => d.LastEditorUserId == user.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.LastEditorUserId, (int?)null), ct);

        // The user row itself. ProcessShares, DeviceSessions and their DataSources (and cells)
        // cascade from here.
        _db.Users.Remove(user);
        await _db.SaveChangesAsync(ct);

        // Audit after the delete, with a null user id: the row must outlive the account it
        // describes, which is exactly what the denormalised UserName is for.
        await _events.LogAsync("Audit", "System", "UserDeleted",
            $"User '{userName}' (#{user.Id}) deleted with all owned processes and data sources.",
            userName: User.Identity?.Name, detailsJson: null, ct: ct);

        return null;
    }

    /// <summary>The signed-in admin's id, or 0 when the claim is absent/unparsable.</summary>
    private int CurrentUserId =>
        int.TryParse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var id)
            ? id
            : 0;

    private async Task FillPlans(CancellationToken ct)
    {
        // No plans are offered when the licence has no plan management, so there is nothing to load.
        if (!await AllowsPlanManagementAsync(ct))
        {
            ViewBag.Plans = null;
            return;
        }

        ViewBag.Plans = await _db.Plans.AsNoTracking()
            .OrderBy(p => p.SortOrder)
            .Select(p => new SelectListItem
            {
                Value = p.Id.ToString(),
                Text = $"{p.Code} — {p.NameEn} / {p.NameFa}"
            })
            .ToListAsync(ct);
    }
}
