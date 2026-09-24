using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Morobot.Infrastructure.Services;
using Morobot.Licensing;

namespace Morobot.Web.Filters;

/// <summary>Enterprise licensing: trial, licensed, or restricted (login + view processes only).</summary>
public sealed class LicenseGateFilter : IAsyncActionFilter
{
    private readonly LicenseService _license;

    public LicenseGateFilter(LicenseService license) => _license = license;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!_license.IsLicensingEnabled)
        {
            await next();
            return;
        }

        var runtime = await _license.GetRuntimeStateAsync(context.HttpContext.RequestAborted);
        if (runtime.FullFeatures)
        {
            await next();
            return;
        }

        if (runtime.ViewOnly && IsAllowedInRestrictedMode(context))
        {
            await next();
            return;
        }

        if (IsAlwaysAllowed(context))
        {
            await next();
            return;
        }

        var area = context.RouteData.Values["area"]?.ToString();
        if (string.Equals(area, "Admin", StringComparison.OrdinalIgnoreCase))
        {
            context.Result = new RedirectToActionResult("Index", "License", new { area = "Admin" });
            return;
        }

        context.Result = new RedirectToActionResult("Login", "Account", new { area = "Panel" });
    }

    private static bool IsAlwaysAllowed(ActionExecutingContext context)
    {
        var path = context.HttpContext.Request.Path.Value ?? "";
        if (path.StartsWith("/css/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/js/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/img/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/locales/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase))
            return true;

        var area = context.RouteData.Values["area"]?.ToString();
        var controller = context.RouteData.Values["controller"]?.ToString();
        var action = context.RouteData.Values["action"]?.ToString();

        if (string.Equals(area, "Admin", StringComparison.OrdinalIgnoreCase)
            && string.Equals(controller, "License", StringComparison.OrdinalIgnoreCase))
            return true;

        if (string.Equals(area, "Panel", StringComparison.OrdinalIgnoreCase)
            && string.Equals(controller, "Account", StringComparison.OrdinalIgnoreCase)
            && (string.Equals(action, "Login", StringComparison.OrdinalIgnoreCase)
                || string.Equals(action, "Logout", StringComparison.OrdinalIgnoreCase)))
            return true;

        if (path.StartsWith("/api/auth", StringComparison.OrdinalIgnoreCase))
            return true;

        if (string.IsNullOrEmpty(area)
            && string.Equals(controller, "Home", StringComparison.OrdinalIgnoreCase)
            && (string.Equals(action, "Index", StringComparison.OrdinalIgnoreCase)
                || string.Equals(action, "SetupGuide", StringComparison.OrdinalIgnoreCase)
                || string.Equals(action, "SetupGuideDownload", StringComparison.OrdinalIgnoreCase)
                || string.Equals(action, "Error", StringComparison.OrdinalIgnoreCase)))
            return true;

        return false;
    }

    private static bool IsAllowedInRestrictedMode(ActionExecutingContext context)
    {
        if (IsAlwaysAllowed(context))
            return true;

        var path = context.HttpContext.Request.Path.Value ?? "";
        var area = context.RouteData.Values["area"]?.ToString();
        var controller = context.RouteData.Values["controller"]?.ToString();
        var action = context.RouteData.Values["action"]?.ToString();
        var method = context.HttpContext.Request.Method;

        if (string.Equals(area, "Panel", StringComparison.OrdinalIgnoreCase))
        {
            if (string.Equals(controller, "Home", StringComparison.OrdinalIgnoreCase)
                && (string.Equals(action, "Index", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(action, "Processes", StringComparison.OrdinalIgnoreCase)))
                return true;

            if (string.Equals(controller, "Tasks", StringComparison.OrdinalIgnoreCase)
                && string.Equals(action, "Graph", StringComparison.OrdinalIgnoreCase)
                && string.Equals(method, "GET", StringComparison.OrdinalIgnoreCase))
                return true;
        }

        if (path.StartsWith("/api/tasks", StringComparison.OrdinalIgnoreCase)
            && string.Equals(method, "GET", StringComparison.OrdinalIgnoreCase))
            return true;

        return false;
    }
}
