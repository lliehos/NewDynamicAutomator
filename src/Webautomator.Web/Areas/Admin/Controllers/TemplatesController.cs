using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Webautomator.Contracts.Tasks;
using Webautomator.Infrastructure.Services;
using Webautomator.Web.Services;

namespace Webautomator.Web.Areas.Admin.Controllers;

/// <summary>
/// Admin view of the shared process templates, with deletion.
/// </summary>
/// <remarks>
/// The Panel page at <c>/Panel/Home/Templates</c> is where templates are authored and published —
/// it is gated on <c>ProcessManager</c>, so an administrator who only holds the <c>Admin</c> role
/// cannot open it (the Panel blocks admins outright). Without this page that left admins able to
/// manage everything else in the product but unable to see the templates at all, which is the gap
/// this closes.
///
/// Authoring stays in the Panel: duplicating the publish flow here would give the same template two
/// authoring surfaces that could disagree about the current version. Deleting is the exception —
/// removing a template is not authoring it, and an admin cleaning up the install is exactly who
/// should be able to do it.
/// </remarks>
[Area("Admin")]
[Authorize(Roles = "Admin")]
public class TemplatesController : Controller
{
    private readonly TemplateService _templates;
    private readonly ILocaleService _locale;

    public TemplatesController(TemplateService templates, ILocaleService locale)
    {
        _templates = templates;
        _locale = locale;
    }

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        // IncludeInactive: an admin reviewing the product needs the retired ones too, otherwise a
        // template that stopped being offered looks like it never existed.
        var list = await _templates.ListAsync(includeInactive: true, ct);
        return View(list);
    }

    /// <summary>
    /// Delete one template. Its attached processes are detached (they keep their own graph from then
    /// on) rather than deleted, which is why the confirmation names the attached count.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var (ok, _, detached) = await _templates.DeleteAsync(id, ct);
        if (ok)
        {
            TempData["Ok"] = _locale.T("admin.templates.deleted",
                ("count", "1"), ("detached", detached.ToString()));
        }
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Delete the rows the admin ticked in the list (checkbox column).</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteMany(int[] ids, CancellationToken ct)
    {
        var (deleted, detached) = ids is { Length: > 0 }
            ? await _templates.DeleteManyAsync(ids, ct)
            : (0, 0);
        if (deleted > 0)
        {
            TempData["Ok"] = _locale.T("admin.templates.deleted",
                ("count", deleted.ToString()), ("detached", detached.ToString()));
        }
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Delete every template no process follows — the one-click cleanup for the leftovers the list
    /// already shows as unused.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeleteUnused(CancellationToken ct)
    {
        var deleted = await _templates.DeleteUnusedAsync(ct);
        if (deleted > 0)
        {
            TempData["Ok"] = _locale.T("admin.templates.deletedUnused", ("count", deleted.ToString()));
        }
        return RedirectToAction(nameof(Index));
    }
}
