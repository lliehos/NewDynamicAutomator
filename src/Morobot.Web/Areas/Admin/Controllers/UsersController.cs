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
    private readonly PasswordHasher<AppUser> _hasher = new();

    public UsersController(
        AppDbContext db,
        EventLogService events,
        PlaySessionTracker plays,
        LicenseService license,
        DeploymentBindingService deploymentBinding)
    {
        _db = db;
        _events = events;
        _plays = plays;
        _license = license;
        _deploymentBinding = deploymentBinding;
    }

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

        Plan? plan = null;
        if (planId is int pid)
            plan = await _db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == pid, ct);
        plan ??= await _db.Plans.AsNoTracking().FirstAsync(p => p.Code == nameof(PlanCode.Free), ct);

        var (pwdOk, pwdErr) = PasswordPolicy.Validate(password, plan);
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

        Plan? targetPlan = user.Plan;
        if (planId is int pid)
            targetPlan = await _db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == pid, ct)
                         ?? targetPlan;
        targetPlan ??= await _db.Plans.AsNoTracking().FirstAsync(p => p.Code == nameof(PlanCode.Free), ct);

        var wasStrict = user.Plan is not null && PasswordPolicy.IsStrict(user.Plan);
        var needsStrict = PasswordPolicy.IsStrict(targetPlan);

        if (needsStrict && !wasStrict && string.IsNullOrWhiteSpace(newPassword))
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
            var (pwdOk, pwdErr) = PasswordPolicy.Validate(newPassword, targetPlan);
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
        user.PlanId = planId;
        user.Role = role;
        user.IsActive = isActive;
        await _db.SaveChangesAsync(ct);
        TempData["Ok"] = "Saved.";
        return RedirectToAction(nameof(Index));
    }

    private async Task FillPlans(CancellationToken ct)
    {
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
