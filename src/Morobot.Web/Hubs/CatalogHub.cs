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
    /// <summary>Desktop players, so a staged release can be announced to every connected one.</summary>
    public static string DesktopPlayersGroup => "catalog-desktop-players";

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

    /// <summary>
    /// Desktop players join this to be told when a new build is staged, rather than polling.
    /// </summary>
    /// <remarks>
    /// Authenticated like the rest of the hub: a signed-in player is a normal user, and the group
    /// carries only a version number and a download URL — nothing tenant-specific — so membership
    /// needs no stronger check than "is a signed-in user".
    /// </remarks>
    public async Task JoinDesktopPlayers()
    {
        var id = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(id, out var userId) || userId <= 0)
            throw new HubException("Unauthorized");
        await Groups.AddToGroupAsync(Context.ConnectionId, DesktopPlayersGroup);
    }

    public async Task LeaveDesktopPlayers()
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, DesktopPlayersGroup);
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
