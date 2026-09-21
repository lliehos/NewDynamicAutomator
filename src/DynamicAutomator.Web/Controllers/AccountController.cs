using DynamicAutomator.Domain.Entities;
using DynamicAutomator.Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DynamicAutomator.Web.Controllers;

/// <summary>Local-first MVP: fake login, no server credential check.</summary>
public class AccountController : Controller
{
    private readonly AuthService _auth;

    public AccountController(AuthService auth) => _auth = auth;

    [HttpGet]
    [AllowAnonymous]
    public IActionResult Login(string? returnUrl = null)
    {
        if (User.Identity?.IsAuthenticated == true)
            return RedirectToAction("Index", "Home");
        ViewBag.ReturnUrl = returnUrl;
        return View();
    }

    [HttpPost]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public IActionResult Login(string userName, string password, string? returnUrl)
    {
        // Fake login: any credentials (or empty) → local test user JWT cookie.
        var name = string.IsNullOrWhiteSpace(userName) ? "test" : userName.Trim();
        var fake = new AppUser
        {
            Id = 1,
            UserName = name,
            FirstName = "کاربر",
            LastName = "تست",
            IsActive = true
        };
        var token = _auth.CreateToken(fake);

        Response.Cookies.Append(AuthService.CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });
        // Readable by JS for per-user localStorage keys.
        Response.Cookies.Append("da_local_user", name, new CookieOptions
        {
            HttpOnly = false,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });

        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            return Redirect(returnUrl);
        return RedirectToAction("Index", "Home");
    }

    [Authorize]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(AuthService.CookieName);
        Response.Cookies.Delete("da_local_user");
        return RedirectToAction(nameof(Login));
    }
}
