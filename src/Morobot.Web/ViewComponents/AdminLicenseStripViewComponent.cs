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
            AlertClass = ResolveAlertClass(display),
            IsExpiringSoon = IsExpiringSoon(display)
        };
        return View(model);
    }

    /// <summary>Remaining days at or below which the strip warns that the licence is about to end.</summary>
    private const int ExpiringSoonDays = 30;

    /// <summary>
    /// A licence that is still valid but close to its end date. Thirty days is the point at
    /// which the admin needs to start renewing, so the strip is painted as a warning then
    /// rather than staying green until the day it lapses.
    /// </summary>
    private static bool IsExpiringSoon(LicenseDisplayDto d)
    {
        if (d.RuntimeMode != nameof(LicenseRuntimeMode.Licensed)) return false;
        if (d.Status == "HostMismatch") return false;
        if (d.ValidityEndsAtUtc is null || d.ValidityEndsAtUtc <= DateTime.UtcNow) return false;
        var days = d.DaysRemaining ?? (int)Math.Floor((d.ValidityEndsAtUtc.Value - DateTime.UtcNow).TotalDays);
        return days <= ExpiringSoonDays;
    }

    private string ResolveAlertClass(LicenseDisplayDto d)
    {
        // Warn before it lapses: a licence inside the last month is still valid, but the
        // admin should not first learn about it when it turns red.
        if (IsExpiringSoon(d)) return "is-expiring";

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
    /// <summary>Valid licence inside the last month — the view adds an explicit renew hint.</summary>
    public bool IsExpiringSoon { get; set; }
}
