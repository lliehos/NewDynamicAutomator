using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Webautomator.Infrastructure.Services;

namespace Webautomator.Web.Controllers.Api;

/// <summary>
/// Licence endpoints for clients that must honour the deployment's own gate.
/// </summary>
/// <remarks>
/// The desktop Player fetches the signed document from here and verifies it with the same public
/// keys as the server. Before this endpoint existed the Player looked for a path nothing served, so
/// a perfectly valid licence always reported as "no valid licence for this server".
/// </remarks>
[ApiController]
[Route("api/license")]
public class LicenseApiController : ControllerBase
{
    private readonly LicenseService _license;

    public LicenseApiController(LicenseService license)
    {
        _license = license;
    }

    /// <summary>The deployment's stored signed licence document, verbatim.</summary>
    [HttpGet("document")]
    [Authorize]
    public async Task<IActionResult> Document(CancellationToken ct)
    {
        var json = await _license.GetCurrentLicenseJsonAsync(ct);
        if (string.IsNullOrWhiteSpace(json)) return NotFound();
        // Returned verbatim: re-serializing would invalidate the signature the client verifies.
        return Content(json, "application/json");
    }
}
