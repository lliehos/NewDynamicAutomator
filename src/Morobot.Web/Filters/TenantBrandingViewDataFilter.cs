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
        var executed = await next();
        if (executed.Result is not ViewResult vr || context.Controller is not Controller controller)
            return;

        var head = await _branding.GetHeadAsync(context.HttpContext.RequestAborted);
        controller.ViewData["BrandHead"] = head;
        if (vr.ViewData != null)
            vr.ViewData["BrandHead"] = head;
    }
}
