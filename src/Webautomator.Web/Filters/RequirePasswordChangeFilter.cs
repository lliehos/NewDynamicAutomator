using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using Webautomator.Infrastructure.Identity;

namespace Webautomator.Web.Filters;

/// <summary>
/// A user whose plan now demands a password the account does not hold finishes that change first.
/// </summary>
/// <remarks>
/// The flag is raised by an admin moving the user to a stricter plan without setting a password (nobody
/// can tell whether the stored one would pass — only its hash is kept), so the user picks a new one
/// themselves instead of the admin having to invent and hand one over. Like the profile gate, the
/// redirect target is the settings page, which is where the password form lives; the claim travels in
/// the token, so this costs no query per request.
/// </remarks>
public sealed class RequirePasswordChangeFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            await next();
            return;
        }

        // Admins cannot use the panel at all, so they are not held here.
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
                    || string.Equals(action, "SetLanguage", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(action, "ChangePassword", StringComparison.OrdinalIgnoreCase)));

        if (allowed)
        {
            await next();
            return;
        }

        if (user.FindFirstValue("password_change_required") == "1")
        {
            // A directory-owned account has no local password to change — its rule is the directory's —
            // and for one auto-provisioned there its local password is a random string nobody knows,
            // so the change form could never be submitted. Checked here rather than only where the
            // requirement is raised, so an account that became directory-managed afterwards (or one
            // flagged before the directory was switched on) is not stranded.
            if (await IsDirectoryManagedAsync(context))
            {
                await next();
                return;
            }

            context.Result = new RedirectToActionResult("Index", "Settings", new { area = "Panel", pwd = 1 });
            return;
        }

        await next();
    }

    private static async Task<bool> IsDirectoryManagedAsync(ActionExecutingContext context)
    {
        var id = context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(id, out var userId) || userId <= 0) return false;
        // Resolved from the request rather than injected: a global filter is a singleton, and this only
        // runs for the accounts the gate would otherwise block.
        var services = context.HttpContext.RequestServices;
        var auth = services is null ? null : services.GetService<AuthService>();
        return auth is not null && await auth.IsDirectoryManagedAsync(userId, context.HttpContext.RequestAborted);
    }
}
