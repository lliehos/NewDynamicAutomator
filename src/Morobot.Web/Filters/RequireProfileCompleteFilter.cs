using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Morobot.Web.Filters;

/// <summary>Panel users must complete FirstName/LastName/Email/Mobile before using the app.</summary>
public sealed class RequireProfileCompleteFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            await next();
            return;
        }

        // Admins and incomplete-profile exemptions
        if (user.IsInRole("Admin"))
        {
            await next();
            return;
        }

        var area = context.RouteData.Values["area"]?.ToString();
        if (!string.Equals(area, "Panel", StringComparison.OrdinalIgnoreCase))
        {
            await next();
            return;
        }

        var controller = context.RouteData.Values["controller"]?.ToString() ?? "";
        var action = context.RouteData.Values["action"]?.ToString() ?? "";

        var allowed =
            string.Equals(controller, "Account", StringComparison.OrdinalIgnoreCase)
            || (string.Equals(controller, "Settings", StringComparison.OrdinalIgnoreCase)
                && (string.Equals(action, "Index", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(action, "SaveProfile", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(action, "SetLanguage", StringComparison.OrdinalIgnoreCase)));

        if (allowed)
        {
            await next();
            return;
        }

        var complete = user.FindFirstValue("profile_complete") == "1";
        if (!complete)
        {
            context.Result = new RedirectToActionResult("Index", "Settings", new { area = "Panel", incomplete = 1 });
            return;
        }

        await next();
    }
}
