using System.Security.Claims;
using Morobot.Contracts.Auth;
using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Controllers.Api;

[ApiController]
[Route("api/events")]
public class EventsApiController : ControllerBase
{
    private readonly EventLogService _events;

    public EventsApiController(EventLogService events) => _events = events;

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Post([FromBody] ClientEventRequest request, CancellationToken ct)
    {
        var userId = int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : (int?)null;
        var userName = User.Identity?.Name;
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        await _events.LogClientAsync(userId, userName, request, ip, ct);
        return Accepted();
    }

    /// <summary>Anonymous beacon for pre-login errors (rate/size limited by middleware norms).</summary>
    [HttpPost("public")]
    [AllowAnonymous]
    public async Task<IActionResult> PostPublic([FromBody] ClientEventRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Message) && string.IsNullOrWhiteSpace(request.EventType))
            return BadRequest();
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        await _events.LogClientAsync(null, null, request, ip, ct);
        return Accepted();
    }
}
