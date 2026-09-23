using System.Security.Claims;
using Morobot.Contracts.Auth;
using Morobot.Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AuthService _auth;

    public AuthController(AuthService auth) => _auth = auth;

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        var (result, errorKey) = await _auth.LoginAsync(request, HttpContext.Connection.RemoteIpAddress?.ToString(), ct);
        if (result is null)
            return Unauthorized(new { message = errorKey ?? "login.errorInvalid", code = errorKey });

        Response.Cookies.Append(AuthService.CookieName, result.Token, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddHours(12)
        });

        return Ok(result);
    }

    [HttpPost("logout")]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(AuthService.CookieName);
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize]
    public ActionResult<MeResponse> Me()
    {
        return Ok(new MeResponse
        {
            IsAuthenticated = true,
            UserId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "0"),
            UserName = User.Identity?.Name ?? string.Empty
        });
    }
}
