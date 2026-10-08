using System.Security.Claims;
using Webautomator.Contracts.Auth;
using Webautomator.Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Webautomator.Web.Areas.Panel.Controllers;

[Area("Panel")]
public class AccountController : Controller
{
    private readonly AuthService _auth;
    private readonly IWebHostEnvironment _env;
    private readonly AuthModeResolver _authMode;

    public AccountController(AuthService auth, IWebHostEnvironment env, AuthModeResolver authMode)
    {
        _auth = auth;
        _env = env;
        _authMode = authMode;
    }

    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> Login(string? returnUrl = null, CancellationToken ct = default)
    {
        if (User.Identity?.IsAuthenticated == true)
            return RedirectToAction("Index", "Home", new { area = "Panel" });
        ViewBag.ReturnUrl = returnUrl;
        ViewBag.Error = TempData["LoginError"];
        // Which sign-in methods are live decides the page's shape: with one method there is nothing
        // to choose, so no chooser is shown; with both, the visitor picks and the form is filled
        // for them, because the two need different input types (national code vs directory account).
        // The method is an administrative decision, but once two are enabled the visitor does have
        // to say which account they are using, so the chooser appears exactly then.
        ViewBag.AuthProviders = await _authMode.GetProvidersAsync(ct);
        return View();
    }

    [HttpGet]
    [AllowAnonymous]
    public IActionResult Register(string? returnUrl = null)
    {
        if (User.Identity?.IsAuthenticated == true)
            return RedirectToAction("Index", "Home", new { area = "Panel" });
        ViewBag.ReturnUrl = returnUrl;
        ViewBag.Error = TempData["RegisterError"];
        return View();
    }

    [HttpPost]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Register(
        string userName,
        string password,
        string? confirmPassword,
        string? firstName,
        string? lastName,
        string? email,
        string? returnUrl,
        string? deviceJson = null,
        CancellationToken ct = default)
    {
        var device = ParseDevice(deviceJson);
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var (result, errorKey) = await _auth.RegisterAsync(new RegisterRequest
        {
            UserName = userName,
            Password = password,
            ConfirmPassword = confirmPassword,
            FirstName = firstName,
            LastName = lastName,
            Email = email,
            Device = device
        }, ip, ct);

        if (result is null)
        {
            TempData["RegisterError"] = errorKey ?? "register.errorInvalid";
            return RedirectToAction(nameof(Register), new { returnUrl });
        }

        IssueSessionCookies(result.Token, result.UserName);

        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            return Redirect(returnUrl);

        return RedirectToAction("Index", "Home", new { area = "Panel" });
    }

    [HttpGet]
    [Authorize]
    public async Task<IActionResult> Upgrade(string? target = null, CancellationToken ct = default)
    {
        var plans = await _auth.ListSelfUpgradePlansAsync(ct);
        ViewBag.Plans = plans;
        ViewBag.Target = string.IsNullOrWhiteSpace(target)
            ? plans.FirstOrDefault()?.Code ?? "Pro"
            : target.Trim();
        ViewBag.Error = TempData["UpgradeError"];
        ViewBag.Ok = TempData["UpgradeOk"];
        return View();
    }

    [HttpPost]
    [Authorize]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Upgrade(
        string targetPlan,
        string currentPassword,
        string newPassword,
        string? confirmPassword,
        CancellationToken ct = default)
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "0");
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var (result, errorKey) = await _auth.UpgradePlanAsync(userId, new UpgradePlanRequest
        {
            TargetPlan = targetPlan,
            CurrentPassword = currentPassword,
            NewPassword = newPassword,
            ConfirmPassword = confirmPassword
        }, ip, ct);

        if (result is null)
        {
            TempData["UpgradeError"] = errorKey ?? "plan.upgrade.errorInvalid";
            return RedirectToAction(nameof(Upgrade), new { target = targetPlan });
        }

        IssueSessionCookies(result.Token, result.UserName);
        TempData["UpgradeOk"] = "plan.upgrade.success";
        return RedirectToAction(nameof(Upgrade));
    }

    /// <summary>
    /// Dev-only one-click login as a seeded account.
    /// </summary>
    /// <remarks>
    /// The demo accounts (guest/free/pro/pm) are no longer seeded by default — a fresh install gets
    /// the administrator only — so this endpoint now signs in as <c>admin</c> unless a name is given
    /// explicitly. It stays Development-only, and a name it cannot resolve simply fails the login
    /// rather than being silently mapped to some other account.
    /// </remarks>
    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> DevLogin(string? userName = null, string? returnUrl = null, CancellationToken ct = default)
    {
        if (!_env.IsDevelopment())
            return NotFound();

        var name = string.IsNullOrWhiteSpace(userName) ? "admin" : userName.Trim();
        var password = name.ToLowerInvariant() switch
        {
            "admin" => "Admin123!",
            "guest" => "Guest123!",
            "free" => "Free123!",
            "pro" => "Pro123!",
            "pm" => "Pm123!",
            // No fallback password: a name we do not know is a name we cannot sign in as, and guessing
            // would either fail confusingly or — worse — succeed against an unintended account.
            _ => null
        };
        if (password is null)
            return Unauthorized();

        var (result, _) = await _auth.LoginAsync(new LoginRequest
        {
            UserName = name,
            Password = password,
            Device = new DeviceFingerprintDto
            {
                FingerprintHash = "devlogin",
                MachineFingerprint = "devlogin",
                UserAgent = "DevLogin",
                Platform = "dev"
            }
        }, HttpContext.Connection.RemoteIpAddress?.ToString(), ct);

        if (result is null)
            return Unauthorized();

        IssueSessionCookies(result.Token, result.UserName);

        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            return Redirect(returnUrl);
        return RedirectToAction("Index", "Home", new { area = "Panel" });
    }

    [HttpPost]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Login(
        string userName,
        string password,
        string? returnUrl,
        string? deviceJson = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(password))
        {
            TempData["LoginError"] = "login.errorRequired";
            return RedirectToAction(nameof(Login), new { returnUrl });
        }

        var device = ParseDevice(deviceJson);
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var (result, errorKey) = await _auth.LoginAsync(new LoginRequest
        {
            UserName = userName.Trim(),
            Password = password,
            Device = device
        }, ip, ct);

        if (result is null)
        {
            TempData["LoginError"] = errorKey ?? "login.errorInvalid";
            return RedirectToAction(nameof(Login), new { returnUrl });
        }

        IssueSessionCookies(result.Token, result.UserName);

        var isAdmin = string.Equals(result.Role, "Admin", StringComparison.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl)
            && !(isAdmin && returnUrl.Contains("/Panel", StringComparison.OrdinalIgnoreCase)
                 && !returnUrl.Contains("/Panel/Account", StringComparison.OrdinalIgnoreCase)))
            return Redirect(returnUrl);

        if (isAdmin)
            return RedirectToAction("Index", "Home", new { area = "Admin" });

        return RedirectToAction("Index", "Home", new { area = "Panel" });
    }

    private static DeviceFingerprintDto? ParseDevice(string? deviceJson)
    {
        if (string.IsNullOrWhiteSpace(deviceJson)) return null;
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<DeviceFingerprintDto>(deviceJson,
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch
        {
            return null;
        }
    }

    private void IssueSessionCookies(string token, string userName)
    {
        Response.Cookies.Append(AuthService.CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });
        Response.Cookies.Append("da_local_user", userName, new CookieOptions
        {
            HttpOnly = false,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });
        Response.Cookies.Delete("da_auth_mode");
    }

    [Authorize]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(AuthService.CookieName);
        Response.Cookies.Delete("da_local_user");
        Response.Cookies.Delete("da_auth_mode");
        return RedirectToAction(nameof(Login), "Account", new { area = "Panel" });
    }
}
