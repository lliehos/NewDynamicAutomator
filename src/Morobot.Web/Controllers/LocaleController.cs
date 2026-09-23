using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Controllers;

[AllowAnonymous]
[Route("locale")]
public class LocaleController : Controller
{
    [HttpPost("set")]
    [IgnoreAntiforgeryToken]
    public IActionResult Set([FromForm] string lang, [FromForm] string? returnUrl = null)
    {
        LocaleService.SetCookie(Response, lang);
        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            return Redirect(returnUrl);
        var referer = Request.Headers.Referer.ToString();
        if (!string.IsNullOrWhiteSpace(referer) && Uri.TryCreate(referer, UriKind.Absolute, out var uri)
            && string.Equals(uri.Host, Request.Host.Host, StringComparison.OrdinalIgnoreCase))
            return Redirect(uri.PathAndQuery);
        return Redirect("/");
    }

    [HttpGet("set")]
    public IActionResult SetGet(string lang, string? returnUrl = null)
        => Set(lang, returnUrl);
}
