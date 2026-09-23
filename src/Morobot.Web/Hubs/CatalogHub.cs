using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Hubs;

/// <summary>Live process / data-source catalog — per-user groups + admin overview group.</summary>
[Authorize]
public class CatalogHub : Hub
{
    public static string UserGroup(int userId) => $"catalog-user-{userId}";
    public static string AdminGroup => "catalog-admins";

    public async Task JoinCatalog()
    {
        var id = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(id, out var userId) || userId <= 0)
            throw new HubException("Unauthorized");
        await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(userId));
    }

    public async Task LeaveCatalog()
    {
        var id = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(id, out var userId) || userId <= 0)
            return;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, UserGroup(userId));
    }

    /// <summary>Admins join a shared group to watch all process/source/play catalog events.</summary>
    public async Task JoinAdminCatalog()
    {
        if (Context.User?.IsInRole("Admin") != true)
            throw new HubException("Forbidden");
        await Groups.AddToGroupAsync(Context.ConnectionId, AdminGroup);
    }

    public async Task LeaveAdminCatalog()
    {
        if (Context.User?.IsInRole("Admin") != true)
            return;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, AdminGroup);
    }
}
