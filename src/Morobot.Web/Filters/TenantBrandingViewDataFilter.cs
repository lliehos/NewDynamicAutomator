using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Morobot.Web.Models;
using Morobot.Web.Services;

namespace Morobot.Web.Filters;

/// <summary>Exposes resolved tenant branding on ViewData["BrandHead"] for all MVC views.</summary>
public sealed class TenantBrandingViewDataFilter : IAsyncActionFilter
{
    private readonly TenantBrandingViewService _branding;

    public TenantBrandingViewDataFilter(TenantBrandingViewService branding)
    {
        _branding = branding;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var head = await _branding.GetHeadAsync(context.HttpContext.RequestAborted);
        // Cached on the request so LocaleService can resolve brand-aware locale keys.
        context.HttpContext.Items[BrandHeadModel.ItemKey] = head;

        var executed = await next();
        if (executed.Result is not ViewResult vr || context.Controller is not Controller controller)
            return;

        controller.ViewData["BrandHead"] = head;
        if (vr.ViewData != null)
            vr.ViewData["BrandHead"] = head;
    }
}
