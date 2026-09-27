using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Morobot.Infrastructure.Services;
using Morobot.Licensing;
using Morobot.Web.Models;
using Morobot.Web.Services;

namespace Morobot.Web.Filters;

/// <summary>Exposes resolved tenant branding on ViewData["BrandHead"] for all MVC views.</summary>
public sealed class TenantBrandingViewDataFilter : IAsyncActionFilter
{
    /// <summary>Key under which the runtime licence state is cached on the request.</summary>
    public const string LicenseStateKey = "da.LicenseRuntimeState";

    private readonly TenantBrandingViewService _branding;
    private readonly LicenseService _license;
    private readonly DatabaseSetupState _dbSetup;

    public TenantBrandingViewDataFilter(
        TenantBrandingViewService branding, LicenseService license, DatabaseSetupState dbSetup)
    {
        _branding = branding;
        _license = license;
        _dbSetup = dbSetup;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        // While the database is unreachable this filter is the next thing to run, and both services
        // below read from it. Letting them try would throw inside the filter — before the setup page
        // could render — turning the one diagnostic page into a 500. Skip the reads and let the view
        // fall back to its built-in branding; the licence state is irrelevant when setup is blocked.
        if (!_dbSetup.IsReady)
        {
            var fallback = new BrandHeadModel();
            context.HttpContext.Items[BrandHeadModel.ItemKey] = fallback;
            if (context.Controller is Controller c)
                c.ViewData["BrandHead"] = fallback;

            var setupExecuted = await next();
            if (setupExecuted.Result is ViewResult setupVr && context.Controller is Controller sc)
            {
                sc.ViewData["BrandHead"] = fallback;
                if (setupVr.ViewData != null)
                    setupVr.ViewData["BrandHead"] = fallback;
            }
            return;
        }

        var head = await _branding.GetHeadAsync(context.HttpContext.RequestAborted);
        // Cached on the request so LocaleService can resolve brand-aware locale keys.
        context.HttpContext.Items[BrandHeadModel.ItemKey] = head;

        // Licence entitlements are needed by the admin nav (and gated controllers).
        // Resolve once per request and stash it so views can read it without a query.
        var runtime = await _license.GetRuntimeStateAsync(context.HttpContext.RequestAborted);
        context.HttpContext.Items[LicenseStateKey] = runtime;

        var executed = await next();
        if (executed.Result is not ViewResult vr || context.Controller is not Controller controller)
            return;

        controller.ViewData["BrandHead"] = head;
        controller.ViewData[LicenseStateKey] = runtime;
        if (vr.ViewData != null)
        {
            vr.ViewData["BrandHead"] = head;
            vr.ViewData[LicenseStateKey] = runtime;
        }
    }
}
