using System.Security.Claims;
using Morobot.Contracts.Auth;
using Morobot.Infrastructure.Identity;
using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Controllers.Api;

[ApiController]
[Route("api/auth")]
public class AuthApiController : ControllerBase
{
    private readonly EntitlementService _entitlements;
    private readonly AuthService _auth;

    public AuthApiController(EntitlementService entitlements, AuthService auth)
    {
        _entitlements = entitlements;
        _auth = auth;
    }

    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Register([FromBody] RegisterRequest request, CancellationToken ct)
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var (result, errorKey) = await _auth.RegisterAsync(request, ip, ct);
        if (result is null)
            return BadRequest(new { message = errorKey ?? "register.errorInvalid", code = errorKey });

        Response.Cookies.Append(AuthService.CookieName, result.Token, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });
        return Ok(result);
    }

    [HttpPost("upgrade")]
    [Authorize]
    public async Task<ActionResult<LoginResponse>> Upgrade([FromBody] UpgradePlanRequest request, CancellationToken ct)
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "0");
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var (result, errorKey) = await _auth.UpgradePlanAsync(userId, request, ip, ct);
        if (result is null)
            return BadRequest(new { message = errorKey ?? "plan.upgrade.errorInvalid", code = errorKey });

        Response.Cookies.Append(AuthService.CookieName, result.Token, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });
        return Ok(result);
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<MeResponse>> Me(CancellationToken ct)
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "0");
        var entitlements = await _entitlements.ResolveWithCountsAsync(userId, User, ct);
        return Ok(new MeResponse
        {
            IsAuthenticated = true,
            UserId = userId,
            UserName = User.Identity?.Name ?? string.Empty,
            Role = User.FindFirstValue(EntitlementService.ClaimRole)
                   ?? User.FindFirstValue(ClaimTypes.Role)
                   ?? "User",
            Entitlements = entitlements
        });
    }

    [HttpGet("entitlements")]
    [Authorize]
    public async Task<ActionResult<EntitlementsDto>> Entitlements(CancellationToken ct)
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "0");
        return Ok(await _entitlements.ResolveWithCountsAsync(userId, User, ct));
    }
}
