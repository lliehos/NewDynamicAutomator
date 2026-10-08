using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Webautomator.Web.Filters;

/// <summary>
/// Keeps the built-in <c>admin</c> account out of the Panel app surfaces.
/// </summary>
/// <remarks>
/// Only that one account is barred, and it is barred by NAME rather than by role. The built-in
/// admin is the installation owner: it has no plan, no data of its own, and everything it does
/// happens in /Admin. Sending it to the Panel would drop it into a surface it has nothing to do
/// with, and the admin and panel rails would each offer a link to the other.
///
/// Anyone else holding the Admin role is a normal user who has also been given admin rights —
/// they have a plan and their own processes, so they must keep their Panel. Blanket-blocking the
/// role (which this filter used to do) took the Panel away from exactly the people who were
/// promoted to help run the system, which is the opposite of what the role is for. They get both
/// panels and a switcher between them.
/// </remarks>
public sealed class BlockAdminFromPanelFilter : IAsyncActionFilter
{
    /// <summary>
    /// The built-in owner account. Matched case-insensitively, because sign-in is.
    /// </summary>
    public const string OwnerUserName = "admin";

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated == true && IsOwnerAccount(user))
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

    /// <summary>True for the built-in owner account, and only that account.</summary>
    public static bool IsOwnerAccount(ClaimsPrincipal user)
    {
        var name = user.Identity?.Name;
        return !string.IsNullOrWhiteSpace(name)
               && string.Equals(name.Trim(), OwnerUserName, StringComparison.OrdinalIgnoreCase);
    }
}
