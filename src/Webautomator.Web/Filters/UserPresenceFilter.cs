using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Caching.Memory;
using Webautomator.Infrastructure.Services;
using Webautomator.Web.Services;

namespace Webautomator.Web.Filters;

/// <summary>Throttled LastSeenUtc touch for authenticated Panel requests (admin online column).</summary>
public sealed class UserPresenceFilter : IAsyncActionFilter
{
    private static readonly TimeSpan TouchInterval = TimeSpan.FromMinutes(2);
    private readonly EventLogService _events;
    private readonly IMemoryCache _cache;
    private readonly DatabaseSetupState _dbSetup;

    public UserPresenceFilter(EventLogService events, IMemoryCache cache, DatabaseSetupState dbSetup)
    {
        _events = events;
        _cache = cache;
        _dbSetup = dbSetup;
    }

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        // Presence is a write to the event log. With no database it cannot work, and the setup page
        // has no signed-in user to track anyway — skip the write rather than fail the request.
        if (_dbSetup.IsReady)
            await TouchIfNeededAsync(context);

        await next();
    }

    private async Task TouchIfNeededAsync(ActionExecutingContext context)
    {
        var http = context.HttpContext;
        if (http.User?.Identity?.IsAuthenticated != true) return;

        var area = context.RouteData.Values["area"]?.ToString();
        if (!string.Equals(area, "Panel", StringComparison.OrdinalIgnoreCase)) return;

        var uidStr = http.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(uidStr, out var userId) || userId <= 0) return;

        var cacheKey = $"user-presence:{userId}";
        if (_cache.TryGetValue(cacheKey, out _)) return;

        _cache.Set(cacheKey, true, TouchInterval);
        try
        {
            await _events.TouchPresenceAsync(userId, http.RequestAborted);
        }
        catch
        {
            /* non-critical */
        }
    }
}
