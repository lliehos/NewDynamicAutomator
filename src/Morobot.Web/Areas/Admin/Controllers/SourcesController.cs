using Morobot.Infrastructure.Services;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Admin.Controllers;

[Area("Admin")]
[Authorize(Roles = "Admin")]
public class SourcesController : Controller
{
    private readonly TaskService _tasks;
    private readonly DataSourceService _sources;
    private readonly ILocaleService _locale;

    public SourcesController(TaskService tasks, DataSourceService sources, ILocaleService locale)
    {
        _tasks = tasks;
        _sources = sources;
        _locale = locale;
    }

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var list = await _tasks.ListCanvasSourcesForAdminAsync(ct);
        return View(list);
    }

    [HttpGet]
    public async Task<IActionResult> Detail(int id, CancellationToken ct)
    {
        var dto = await _sources.GetForAdminAsync(id, ct);
        return dto is null ? NotFound() : Json(dto);
    }

    /// <summary>
    /// Delete a library source from the admin panel. Deleting a source detaches it from every
    /// linked process and scrubs its snapshot, so the confirmation in the view names the row.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await _sources.DeleteLibraryForAdminAsync(id, ct);
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Delete the rows the admin ticked in the list (checkbox column).</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteMany(int[] ids, CancellationToken ct)
    {
        var deleted = ids is { Length: > 0 }
            ? await _sources.DeleteManyForAdminAsync(ids, ct)
            : 0;
        if (deleted > 0)
        {
            TempData["Ok"] = _locale.T("admin.sources.deletedMany", ("count", deleted.ToString()));
        }
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Delete every source that no process links to — the one-click cleanup for the leftovers the
    /// list already flags as unused.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteUnused(CancellationToken ct)
    {
        var deleted = await _sources.DeleteUnusedForAdminAsync(ct);
        if (deleted > 0)
        {
            TempData["Ok"] = _locale.T("admin.sources.deletedUnused", ("count", deleted.ToString()));
        }
        return RedirectToAction(nameof(Index));
    }
}
