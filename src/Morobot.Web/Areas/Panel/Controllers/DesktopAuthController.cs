using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Morobot.Infrastructure.Identity;

namespace Morobot.Web.Areas.Panel.Controllers;

/// <summary>
/// The desktop Player's sign-in handshake.
/// </summary>
/// <remarks>
/// The Player does not collect a password. It opens the user's own browser at this server, the user
/// signs in THERE — where the address bar shows the real host and any second factor behaves normally —
/// and the browser hands a short-lived code back to the app, which trades it for an API token. This is
/// the flow VS Code and the GitHub CLI use, for the same reason: an app that asks for a panel password
/// trains users to type it into something that is not the panel.
///
/// The handshake is a polling pair rather than a custom URL scheme, because a desktop app must
/// otherwise be registered with the OS as a scheme handler — an installer change we do not want.
/// </remarks>
[Area("Panel")]
public class DesktopAuthController : Controller
{
    private readonly AuthService _auth;
    private readonly IDataProtector _codes;
    private readonly ILogger<DesktopAuthController> _log;

    /// <summary>
    /// How long a handshake stays meaningful. Short, because it only matters while the user is
    /// looking at the browser tab that was just opened for them.
    /// </summary>
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(3);

    private sealed class Pending
    {
        public bool Authorized { get; set; }
        public int UserId { get; set; }
        public DateTime ExpiresAtUtc { get; set; }
    }

    /// <summary>
    /// In-flight handshakes, keyed by the random state the app generated.
    /// </summary>
    /// <remarks>
    /// In-memory is deliberate: a handshake lasts seconds and must not survive a restart anyway, so a
    /// table would be write-only garbage.
    /// </remarks>
    private static readonly Dictionary<string, Pending> Requests = new(StringComparer.Ordinal);

    public DesktopAuthController(AuthService auth, IDataProtectionProvider protection, ILogger<DesktopAuthController> log)
    {
        _auth = auth;
        _codes = protection.CreateProtector("Morobot.DesktopAuth.v2");
        _log = log;
    }

    /// <summary>Registers a handshake before the browser is opened. Anonymous — no session exists yet.</summary>
    [AllowAnonymous]
    [HttpPost]
    public IActionResult Begin([FromBody] BeginRequest? body)
    {
        if (body is null || string.IsNullOrWhiteSpace(body.State)) return BadRequest();
        Prune();
        Requests[body.State] = new Pending { ExpiresAtUtc = DateTime.UtcNow.Add(Lifetime) };
        return Json(new { status = "ok" });
    }

    /// <summary>
    /// The page the browser opens. Signs the user in through the normal panel login, then approves the
    /// app's request.
    /// </summary>
    [HttpGet]
    public IActionResult Authorize(string? state)
    {
        if (string.IsNullOrWhiteSpace(state)) return BadRequest("state is required");
        Prune();
        if (!Requests.TryGetValue(state, out var entry)) return NotFound("درخواست ورود یافت نشد یا منقضی شده است.");

        if (User.Identity?.IsAuthenticated != true)
        {
            // Through the ordinary sign-in, remembering to come back to this exact action.
            var back = Url.Action(nameof(Authorize), "DesktopAuth", new { area = "Panel", state })!;
            return RedirectToAction("Login", "Account", new { area = "Panel", returnUrl = back });
        }

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!int.TryParse(userId, out var id)) return BadRequest("شناسه کاربر نامعتبر است.");

        entry.Authorized = true;
        entry.UserId = id;
        entry.ExpiresAtUtc = DateTime.UtcNow.Add(Lifetime);
        _log.LogInformation("Desktop sign-in approved for user {UserId}", id);

        return Content(HandshakePage(true), "text/html", System.Text.Encoding.UTF8);
    }

    /// <summary>
    /// The app polls here until the browser approves it, then receives a one-time code.
    /// </summary>
    /// <remarks>
    /// The TOKEN is not returned here, only a code. A polling loop is long-lived and its responses are
    /// far easier to capture than a single POST, so what travels on it stays useless without the
    /// subsequent exchange.
    /// </remarks>
    [HttpGet]
    public IActionResult Poll(string? state)
    {
        if (string.IsNullOrWhiteSpace(state)) return BadRequest();
        Prune();
        if (!Requests.TryGetValue(state, out var entry)) return Json(new { status = "expired" });
        if (!entry.Authorized) return Json(new { status = "waiting" });

        // One code per handshake: the entry is dropped as soon as it is handed over, so replaying this
        // response cannot mint a second token.
        Requests.Remove(state);
        var expires = DateTime.UtcNow.Add(Lifetime);
        var code = _codes.Protect($"{entry.UserId}|{state}|{expires:O}");
        return Json(new { status = "ready", code });
    }

    /// <summary>
    /// Exchange the one-time code for an API token.
    /// </summary>
    /// <remarks>
    /// The code is bound to the state it was issued for, so a code captured from one handshake cannot
    /// be redeemed in another. It carries no password and no cookie, and it expires quickly.
    /// </remarks>
    [HttpPost]
    public async Task<IActionResult> Redeem([FromBody] RedeemRequest? body, CancellationToken ct)
    {
        if (body is null || string.IsNullOrWhiteSpace(body.Code) || string.IsNullOrWhiteSpace(body.State))
            return BadRequest();

        string raw;
        try { raw = _codes.Unprotect(body.Code); }
        catch { return Unauthorized(new { message = "کد نامعتبر است." }); }

        var parts = raw.Split('|');
        if (parts.Length != 3
            || !int.TryParse(parts[0], out var userId)
            || !string.Equals(parts[1], body.State, StringComparison.Ordinal)
            || !DateTime.TryParse(parts[2], out var until)
            || DateTime.UtcNow > until)
            return Unauthorized(new { message = "کد نامعتبر یا منقضی شده است." });

        var user = await _auth.GetUserAsync(userId, ct);
        if (user is null || !user.IsActive)
            return Unauthorized(new { message = "کاربر یافت نشد." });

        // Minted fresh rather than replayed, so the Player never holds a token the browser ever saw.
        var token = _auth.CreateToken(user);
        _log.LogInformation("Desktop token issued for user {UserId}", userId);
        return Json(new { token, userName = user.UserName, displayName = AuthService.FormatDisplayName(user) });
    }

    private static void Prune()
    {
        var now = DateTime.UtcNow;
        foreach (var key in Requests.Where(kv => kv.Value.ExpiresAtUtc < now).Select(kv => kv.Key).ToList())
            Requests.Remove(key);
    }

    /// <summary>What the user sees in the browser just before returning to the app.</summary>
    private static string HandshakePage(bool ok) =>
        $@"<!doctype html>
<html dir=""rtl"" lang=""fa""><head><meta charset=""utf-8""/>
<meta name=""viewport"" content=""width=device-width, initial-scale=1""/>
<title>ورود به اجراکننده</title>
<style>
  body {{ font-family: Vazirmatn, 'Segoe UI', Tahoma, sans-serif; background:#F5F4FB; color:#334155;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px; }}
  .card {{ background:#fff; border:1px solid #E2E8F0; border-radius:16px; padding:36px 44px;
           text-align:center; max-width:440px; box-shadow:0 12px 34px rgba(15,23,42,.08); }}
  .icon {{ width:52px; height:52px; line-height:52px; margin:0 auto 14px; font-size:26px;
           border-radius:50%; background:{(ok ? "#DCFCE7" : "#FEE2E2")}; }}
  .msg {{ font-size:15px; line-height:2; }}
  .hint {{ font-size:13px; color:#94A3B8; margin-top:10px; }}
</style></head>
<body><div class=""card"">
  <div class=""icon"">{(ok ? "✓" : "!")}</div>
  <div class=""msg"">{(ok ? "ورود با موفقیت انجام شد." : "ورود انجام نشد.")}</div>
  {(ok ? "<div class=\"hint\">می‌توانید این پنجره را ببندید و به برنامه بازگردید.</div>" : "")}
</div></body></html>";

    public sealed class BeginRequest { public string? State { get; set; } }
    public sealed class RedeemRequest { public string? State { get; set; } public string? Code { get; set; } }
}
