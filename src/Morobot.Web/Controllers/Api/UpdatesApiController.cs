using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Morobot.Contracts.Licensing;
using Morobot.Infrastructure.Services;

namespace Morobot.Web.Controllers.Api;

[ApiController]
public sealed class UpdatesApiController : ControllerBase
{
    private readonly ProductUpdateFeedService _feed;
    private readonly UpdateCheckService _updates;

    public UpdatesApiController(ProductUpdateFeedService feed, UpdateCheckService updates)
    {
        _feed = feed;
        _updates = updates;
    }

    /// <summary>Public feed — same contract as https://morobot.ir/checkupdate</summary>
    [HttpGet("/checkupdate")]
    [AllowAnonymous]
    [Produces("application/json")]
    public ActionResult<ProductUpdateCheckResponse> CheckUpdate([FromQuery] string? current)
    {
        return Ok(_feed.BuildResponse(current));
    }

    [HttpGet("api/updates/status")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<UpdateCheckResultDto>> Status(CancellationToken ct)
        => Ok(await _updates.GetStatusAsync(ct));

    [HttpPost("api/updates/check")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<UpdateCheckResultDto>> CheckOnline(CancellationToken ct)
        => Ok(await _updates.CheckOnlineAsync(ct));
}
