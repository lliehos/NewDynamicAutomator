using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Morobot.Web.Hubs;

/// <summary>Live process / data-source catalog updates for list pages.</summary>
[AllowAnonymous]
public class CatalogHub : Hub
{
    public const string GroupName = "catalog";

    public Task JoinCatalog() =>
        Groups.AddToGroupAsync(Context.ConnectionId, GroupName);

    public Task LeaveCatalog() =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName);
}
