using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Morobot.Web.Filters;

/// <summary>Admins use /Admin only — block Panel app surfaces (login/logout still allowed).</summary>
public sealed class BlockAdminFromPanelFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated == true && user.IsInRole("Admin"))
        {
            var area = context.RouteData.Values["area"]?.ToString();
            var controller = context.RouteData.Values["controller"]?.ToString();
            var action = context.RouteData.Values["action"]?.ToString();
            if (string.Equals(area, "Panel", StringComparison.OrdinalIgnoreCase))
            {
                var isAccount = string.Equals(controller, "Account", StringComparison.OrdinalIgnoreCase);
                var allowedAccount = isAccount && (
                    string.Equals(action, "Login", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(action, "Logout", StringComparison.OrdinalIgnoreCase));
                if (!allowedAccount)
                {
                    context.Result = new RedirectToActionResult("Index", "Home", new { area = "Admin" });
                    return;
                }
            }
        }

        await next();
    }
}
