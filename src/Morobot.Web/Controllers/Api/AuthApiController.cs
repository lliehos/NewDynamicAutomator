using System.Security.Claims;
using Morobot.Contracts.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Controllers.Api;

[ApiController]
[Route("api/auth")]
public class AuthApiController : ControllerBase
{
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
