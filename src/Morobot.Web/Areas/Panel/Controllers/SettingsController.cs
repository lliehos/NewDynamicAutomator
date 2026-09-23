using System.Security.Claims;
using Morobot.Infrastructure.Identity;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Panel.Controllers;

[Area("Panel")]
[Authorize]
public class SettingsController : Controller
{
    private readonly ILocaleService _locale;
    private readonly AuthService _auth;

    public SettingsController(ILocaleService locale, AuthService auth)
    {
        _locale = locale;
        _auth = auth;
    }

    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<IActionResult> Index(int? incomplete, CancellationToken ct)
    {
        ViewData["Title"] = _locale["settings.title"];
        ViewBag.Culture = _locale.Culture;
        ViewBag.UserName = User.Identity?.Name ?? "";
        ViewBag.Incomplete = incomplete == 1 || User.FindFirstValue("profile_complete") != "1";

        var dbUser = await _auth.GetUserAsync(UserId, ct);
        ViewBag.FirstName = dbUser?.FirstName ?? "";
        ViewBag.LastName = dbUser?.LastName ?? "";
        ViewBag.Email = dbUser?.Email ?? "";
        ViewBag.Mobile = dbUser?.Mobile ?? "";
        return View();
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SaveProfile(
        string? firstName, string? lastName, string? email, string? mobile, CancellationToken ct)
    {
        var (result, errorKey) = await _auth.UpdateProfileAsync(UserId, firstName, lastName, email, mobile, ct);
        if (result is null)
        {
            TempData["ProfileError"] = errorKey ?? "settings.errorRequired";
            return RedirectToAction(nameof(Index), new { incomplete = 1 });
        }

        Response.Cookies.Append(AuthService.CookieName, result.Token, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });

        TempData["ProfileOk"] = "settings.saved";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult SetLanguage(string lang, string? returnUrl = null)
    {
        LocaleService.SetCookie(Response, lang);
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
