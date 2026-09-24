using Microsoft.AspNetCore.Mvc;
using Morobot.Contracts.Licensing;
using Morobot.Infrastructure.Services;
using Morobot.Licensing;
using Morobot.Web.Services;

namespace Morobot.Web.ViewComponents;

public sealed class AdminLicenseStripViewComponent : ViewComponent
{
    private readonly LicenseService _license;
    private readonly ILocaleService _locale;

    public AdminLicenseStripViewComponent(LicenseService license, ILocaleService locale)
    {
        _license = license;
        _locale = locale;
    }

    public async Task<IViewComponentResult> InvokeAsync()
    {
        var display = await _license.GetDisplayAsync(HttpContext.RequestAborted);
        var model = new AdminLicenseStripModel
        {
            Display = display,
            AlertClass = ResolveAlertClass(display)
        };
        return View(model);
    }

    private string ResolveAlertClass(LicenseDisplayDto d)
    {
        if (d.RuntimeMode == nameof(LicenseRuntimeMode.Licensed)
            && d.Status != "HostMismatch"
            && d.ValidityEndsAtUtc is not null
            && d.ValidityEndsAtUtc > DateTime.UtcNow)
            return "is-ok";

        if (d.RuntimeMode == nameof(LicenseRuntimeMode.Trial))
            return "is-warn";

        if (d.Status == "HostMismatch")
            return "is-warn";

        return "is-error";
    }
}

public sealed class AdminLicenseStripModel
{
    public LicenseDisplayDto Display { get; set; } = new();
    public string AlertClass { get; set; } = "is-warn";
}
