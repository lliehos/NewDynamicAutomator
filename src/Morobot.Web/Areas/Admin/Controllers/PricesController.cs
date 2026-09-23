using Morobot.Domain.Entities;
using Morobot.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class PricesController : Controller
{
    private readonly AppDbContext _db;

    public PricesController(AppDbContext db) => _db = db;

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var prices = await _db.PlanPrices.AsNoTracking()
            .Include(p => p.Plan)
            .OrderByDescending(p => p.Id)
            .ToListAsync(ct);
        return View(prices);
    }

    [HttpGet]
    public async Task<IActionResult> Create(CancellationToken ct)
    {
        await FillPlans(ct);
        return View(new PlanPrice { Currency = "IRR", Interval = "monthly", IsActive = true });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(PlanPrice model, CancellationToken ct)
    {
        if (!await _db.Plans.AnyAsync(p => p.Id == model.PlanId, ct))
        {
            ModelState.AddModelError(nameof(model.PlanId), "Invalid plan");
            await FillPlans(ct);
            return View(model);
        }

        model.CreatedAtUtc = DateTime.UtcNow;
        _db.PlanPrices.Add(model);
        await _db.SaveChangesAsync(ct);
        return RedirectToAction(nameof(Index));
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Toggle(int id, CancellationToken ct)
    {
        var price = await _db.PlanPrices.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (price is null) return NotFound();
        price.IsActive = !price.IsActive;
        await _db.SaveChangesAsync(ct);
        return RedirectToAction(nameof(Index));
    }

    private async Task FillPlans(CancellationToken ct)
    {
        ViewBag.Plans = await _db.Plans.AsNoTracking()
            .Where(p => p.Code != nameof(Domain.Enums.PlanCode.Local))
            .OrderBy(p => p.SortOrder)
            .Select(p => new SelectListItem { Value = p.Id.ToString(), Text = $"{p.Code} — {p.NameEn}" })
            .ToListAsync(ct);
    }
}
