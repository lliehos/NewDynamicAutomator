using Morobot.Domain.Entities;
using Morobot.Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Panel.Controllers;

/// <summary>Local-first MVP: fake login, no server credential check.</summary>
[Area("Panel")]
public class AccountController : Controller
{
    private readonly AuthService _auth;
    private readonly IWebHostEnvironment _env;

    public AccountController(AuthService auth, IWebHostEnvironment env)
    {
        _auth = auth;
        _env = env;
    }

    [HttpGet]
    [AllowAnonymous]
    public IActionResult Login(string? returnUrl = null)
    {
        if (User.Identity?.IsAuthenticated == true)
            return RedirectToAction("Index", "Home", new { area = "Panel" });
        ViewBag.ReturnUrl = returnUrl;
        return View();
    }

    /// <summary>Dev-only one-click login for automated Chrome CDP (no WebSocket form fill).</summary>
    [HttpGet]
    [AllowAnonymous]
    public IActionResult DevLogin(string? userName = null, string? returnUrl = null)
    {
        if (!_env.IsDevelopment())
            return NotFound();

        var name = string.IsNullOrWhiteSpace(userName) ? "test" : userName.Trim();
        IssueLocalSession(name);

        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            return Redirect(returnUrl);
        return RedirectToAction("Index", "Home", new { area = "Panel" });
    }

    [HttpPost]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public IActionResult Login(string userName, string password, string? returnUrl)
    {
        // Fake login: any credentials (or empty) → local test user JWT cookie.
        var name = string.IsNullOrWhiteSpace(userName) ? "test" : userName.Trim();
        IssueLocalSession(name);

        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            return Redirect(returnUrl);
        return RedirectToAction("Index", "Home", new { area = "Panel" });
    }

    private void IssueLocalSession(string name)
    {
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
        Response.Cookies.Append("da_local_user", name, new CookieOptions
        {
            HttpOnly = false,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });
    }

    [Authorize]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(AuthService.CookieName);
        Response.Cookies.Delete("da_local_user");
        return RedirectToAction(nameof(Login), "Account", new { area = "Panel" });
    }
}
