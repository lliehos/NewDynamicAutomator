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
    private readonly IWebHostEnvironment _env;

    public SettingsController(ILocaleService locale, AuthService auth, IWebHostEnvironment env)
    {
        _locale = locale;
        _auth = auth;
        _env = env;
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
        ViewBag.AvatarPath = dbUser?.AvatarPath ?? "";
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

        RefreshAuthCookie(result.Token);

        TempData["ProfileOk"] = "settings.saved";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>
    /// Save the cropped profile image. The cropper sends a PNG/JPEG blob, so this
    /// only has to validate the type/size, store it under a per-user stable name
    /// (so the old file is replaced rather than accumulating) and persist the path.
    /// </summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SaveAvatar(IFormFile? avatar, CancellationToken ct)
    {
        if (avatar is null || avatar.Length == 0)
        {
            TempData["ProfileError"] = "settings.avatarEmpty";
            return RedirectToAction(nameof(Index));
        }

        const long maxBytes = 3 * 1024 * 1024;
        if (avatar.Length > maxBytes)
        {
            TempData["ProfileError"] = "settings.avatarTooLarge";
            return RedirectToAction(nameof(Index));
        }

        var contentType = (avatar.ContentType ?? "").ToLowerInvariant();
        var ext = contentType switch
        {
            "image/png" => ".png",
            "image/jpeg" => ".jpg",
            "image/webp" => ".webp",
            _ => null
        };
        if (ext is null)
        {
            TempData["ProfileError"] = "settings.avatarBadType";
            return RedirectToAction(nameof(Index));
        }

        var dir = Path.Combine(_env.WebRootPath, "uploads", "avatars");
        Directory.CreateDirectory(dir);

        // Stable per-user name: re-uploading replaces the previous avatar, and the
        // cache-busting query on render handles the browser's copy.
        var fileName = $"u{UserId}{ext}";
        var physical = Path.Combine(dir, fileName);
        await using (var stream = System.IO.File.Create(physical))
        {
            await avatar.CopyToAsync(stream, ct);
        }

        // A user who previously had a different extension should not keep both.
        foreach (var other in new[] { ".png", ".jpg", ".webp" })
        {
            var stale = Path.Combine(dir, $"u{UserId}{other}");
            if (!string.Equals(stale, physical, StringComparison.OrdinalIgnoreCase) && System.IO.File.Exists(stale))
            {
                try { System.IO.File.Delete(stale); } catch { /* best effort */ }
            }
        }

        var ok = await _auth.SetAvatarPathAsync(UserId, $"/uploads/avatars/{fileName}", ct);
        if (ok is not null) RefreshAuthCookie(ok);
        TempData[ok is not null ? "ProfileOk" : "ProfileError"] = ok is not null ? "settings.avatarSaved" : "settings.avatarSaveFailed";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Clear the avatar so the UI falls back to initials.</summary>
    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> RemoveAvatar(CancellationToken ct)
    {
        var existing = (await _auth.GetUserAsync(UserId, ct))?.AvatarPath;
        var token = await _auth.SetAvatarPathAsync(UserId, null, ct);
        if (token is not null) RefreshAuthCookie(token);

        if (!string.IsNullOrWhiteSpace(existing))
        {
            // Only ever delete inside the avatar folder — never trust the stored path blindly.
            var name = Path.GetFileName(existing);
            var physical = Path.Combine(_env.WebRootPath, "uploads", "avatars", name);
            if (System.IO.File.Exists(physical))
            {
                try { System.IO.File.Delete(physical); } catch { /* best effort */ }
            }
        }

        TempData["ProfileOk"] = "settings.avatarRemoved";
        return RedirectToAction(nameof(Index));
    }

    /// <summary>Reissue the auth cookie so claim-carried values (avatar, name) stay fresh.</summary>
    private void RefreshAuthCookie(string token)
    {
        Response.Cookies.Append(AuthService.CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(30)
        });
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
