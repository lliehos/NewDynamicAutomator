using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Contracts.Tasks;
using Morobot.Infrastructure.Services;

namespace Morobot.Web.Areas.Admin.Controllers;

/// <summary>
/// Read-only view of the shared process templates.
/// </summary>
/// <remarks>
/// The Panel page at <c>/Panel/Home/Templates</c> is where templates are authored and published —
/// it is gated on <c>ProcessManager</c>, so an administrator who only holds the <c>Admin</c> role
/// cannot open it (the Panel blocks admins outright). Without this page that left admins able to
/// manage everything else in the product but unable to see the templates at all, which is the gap
/// this closes.
///
/// It is deliberately a *view*, not a second editor: templates are shaped next to the processes
/// they came from, and duplicating the publish flow here would give the same template two authoring
/// surfaces that could disagree about the current version.
/// </remarks>
[Area("Admin")]
[Authorize(Roles = "Admin")]
public class TemplatesController : Controller
{
    private readonly TemplateService _templates;

    public TemplatesController(TemplateService templates) => _templates = templates;

    public async Task<IActionResult> Index(CancellationToken ct)
    {
        // IncludeInactive: an admin reviewing the product needs the retired ones too, otherwise a
        // template that stopped being offered looks like it never existed.
        var list = await _templates.ListAsync(includeInactive: true, ct);
        return View(list);
    }
}
