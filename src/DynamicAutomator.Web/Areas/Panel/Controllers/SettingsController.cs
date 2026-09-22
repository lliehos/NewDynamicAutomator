using DynamicAutomator.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Areas.Panel.Controllers;

[Area("Panel")]
[Authorize]
public class SettingsController : Controller
{
    private readonly ILocaleService _locale;

    public SettingsController(ILocaleService locale) => _locale = locale;

    [HttpGet]
    public IActionResult Index()
    {
        ViewData["Title"] = _locale["settings.title"];
        ViewBag.Culture = _locale.Culture;
        ViewBag.UserName = User.Identity?.Name ?? "";
        return View();
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult SetLanguage(string lang, string? returnUrl = null)
    {
        LocaleService.SetCookie(Response, lang);
        // Also mirror into localStorage via a tiny cookie the client already syncs.
        Response.Cookies.Append("da_local_user", User.Identity?.Name ?? "test", new CookieOptions
        {
            HttpOnly = false,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });
        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            return Redirect(returnUrl);
        return RedirectToAction(nameof(Index));
    }
}
