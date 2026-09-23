using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Hubs;

/// <summary>Live process / data-source catalog — one SignalR group per authenticated user.</summary>
[Authorize]
public class CatalogHub : Hub
{
    public static string UserGroup(int userId) => $"catalog-user-{userId}";

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
}
