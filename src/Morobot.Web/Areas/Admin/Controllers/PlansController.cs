using System.Text.RegularExpressions;
using Morobot.Domain.Entities;
using Morobot.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class PlansController : Controller
{
    private static readonly Regex CodePattern = new(@"^[A-Za-z][A-Za-z0-9_]{1,39}$", RegexOptions.Compiled);
    private readonly AppDbContext _db;

    public PlansController(AppDbContext db) => _db = db;

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var plans = await _db.Plans.AsNoTracking()
            .Include(p => p.Prices)
            .OrderBy(p => p.SortOrder)
            .ToListAsync(ct);
        return View(plans);
    }

    [HttpGet]
    public IActionResult Create() => View(new Plan
    {
        IsActive = true,
        MinPasswordLength = 3,
        SortOrder = 10,
        ShareAllowView = true
    });

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(Plan model, CancellationToken ct = default)
    {
        model.Code = (model.Code ?? "").Trim();
        if (!CodePattern.IsMatch(model.Code))
        {
            ModelState.AddModelError(nameof(model.Code), "Code: start with letter; letters/digits/_ (2–40).");
            return View(model);
        }

        if (await _db.Plans.AnyAsync(p => p.Code == model.Code, ct))
        {
            ModelState.AddModelError(nameof(model.Code), "Code already exists.");
            return View(model);
        }

        NormalizePlan(model);
        _db.Plans.Add(model);
        await _db.SaveChangesAsync(ct);
        TempData["Ok"] = "Plan created.";
        return RedirectToAction(nameof(Index));
    }

    [HttpGet]
    public async Task<IActionResult> Edit(int id, CancellationToken ct)
    {
        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == id, ct);
        return plan is null ? NotFound() : View(plan);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Edit(int id, Plan model, CancellationToken ct = default)
    {
        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (plan is null) return NotFound();

        plan.NameFa = model.NameFa?.Trim() ?? plan.NameFa;
        plan.NameEn = model.NameEn?.Trim() ?? plan.NameEn;
        plan.MaxTasks = model.MaxTasks;
        plan.MaxDataSources = model.MaxDataSources;
        plan.CanPlay = model.CanPlay;
        plan.CanSelector = model.CanSelector;
        plan.CanRecord = model.CanRecord;
        plan.CanSmart = model.CanSmart;
        plan.IsActive = model.IsActive;
        plan.SortOrder = model.SortOrder;
        plan.MinPasswordLength = Math.Clamp(model.MinPasswordLength, 1, 128);
        plan.RequireLetterAndDigit = model.RequireLetterAndDigit;
        plan.AllowSelfUpgrade = model.AllowSelfUpgrade;
        plan.CanShare = model.CanShare;
        plan.CanReceiveShare = model.CanReceiveShare;
        plan.MaxSharesPerTask = model.MaxSharesPerTask;
        plan.ShareAllowView = model.ShareAllowView;
        plan.ShareAllowEdit = model.ShareAllowEdit;
        plan.ShareAllowDelete = model.ShareAllowDelete;
        plan.ShareAllowExecute = model.ShareAllowExecute;
        plan.ShareAllowChangeDataSource = model.ShareAllowChangeDataSource;
        await _db.SaveChangesAsync(ct);
        TempData["Ok"] = "Plan saved.";
        return RedirectToAction(nameof(Index));
    }

    private static void NormalizePlan(Plan model)
    {
        model.NameFa = model.NameFa?.Trim() ?? "";
        model.NameEn = model.NameEn?.Trim() ?? "";
        model.MinPasswordLength = Math.Clamp(model.MinPasswordLength <= 0 ? 3 : model.MinPasswordLength, 1, 128);
    }
}
