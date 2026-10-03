using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Morobot.Infrastructure.Services;
using Morobot.Licensing;
using Morobot.Web.Services;

namespace Morobot.Web.Filters;

/// <summary>Enterprise licensing: trial, licensed, or restricted (login + view processes only).</summary>
public sealed class LicenseGateFilter : IAsyncActionFilter
{
    private readonly LicenseService _license;
    private readonly DatabaseSetupState _dbSetup;

    public LicenseGateFilter(LicenseService license, DatabaseSetupState dbSetup)
    {
        _license = license;
        _dbSetup = dbSetup;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        // With no database there is no licence state to read, and this filter runs on every action —
        // including the setup page. Reading would throw before that page could render and replace the
        // one useful diagnostic with a 500. Setup is a prerequisite for licensing, so let it through.
        if (!_dbSetup.IsReady)
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

        if (path.StartsWith("/checkupdate", StringComparison.OrdinalIgnoreCase))
            return true;

        /*
         * Extension delivery.
         *
         * These endpoints carry [AllowAnonymous] because they must be reachable in two very
         * different situations: a signed-in user clicking "download", and the installer script
         * running on the user's own machine, which has no browser cookie at all. That attribute is
         * an AUTHORIZATION concern and does nothing about the licence gate, which is a separate
         * global filter -- so without this exemption every one of them was answered with a redirect
         * to the login page. The visible symptoms were the install modal never resolving a path
         * (it fetches /extension/install-path and treats a non-2xx as "no data") and the download
         * buttons looking broken on a published server.
         *
         * Exempting them here is safe because the controller does not rely on the licence: it
         * enforces its own access rules per endpoint. /extension/download requires either an
         * authenticated user or a signed ticket; /extension/installer requires a ticket. The
         * read-only metadata endpoints expose the same values the install page shows a signed-in
         * user, and reveal no user data.
         */
        if (path.StartsWith("/extension/", StringComparison.OrdinalIgnoreCase))
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

        // Extension delivery stays available in restricted mode too: installing the extension is
        // how a restricted user gets any use out of the deployment at all, and the endpoints
        // enforce their own access rules (authenticated user or signed ticket).
        if (path.StartsWith("/extension/", StringComparison.OrdinalIgnoreCase))
            return true;

        return false;
    }
}
