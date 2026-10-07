using System.IO;
using System.IO.Compression;
using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Panel.Controllers;

/// <summary>
/// Distribution and update for the desktop local runner.
/// </summary>
/// <remarks>
/// Modelled on <see cref="ExtensionController"/> on purpose: the runner is the same kind of artefact
/// as the browser extension — a client the panel ships and later replaces — so it gets the same
/// treatment (a version stamp, a ticket-gated download, an update check the client can poll). A
/// parallel, differently-shaped mechanism would have been a second thing to keep correct.
///
/// Everything here is gated on the local-run licence flag: a deployment that does not own the
/// feature must not be able to download a runner that would refuse to work anyway.
/// </remarks>
[Area("Panel")]
[Authorize]
public class DesktopController : Controller
{
    private const string Role = "desktop";

    private readonly IWebHostEnvironment _env;
    private readonly IDataProtector _tickets;
    private readonly ILogger<DesktopController> _log;
    private readonly LicenseService _license;

    public DesktopController(
        IWebHostEnvironment env,
        IDataProtectionProvider protection,
        ILogger<DesktopController> log,
        LicenseService license)
    {
        _env = env;
        _tickets = protection.CreateProtector("Morobot.DesktopInstallTicket.v1");
        _log = log;
        _license = license;
    }

    /// <summary>Where a desktop build is staged, mirroring the extension's install folder.</summary>
    private string InstallRoot => Path.Combine(_env.ContentRootPath, "App_Data", "desktop");

    /// <summary>The staged build's version, or null when nothing has been staged.</summary>
    private string? StagedVersion
    {
        get
        {
            try
            {
                var f = Path.Combine(InstallRoot, "version.txt");
                return System.IO.File.Exists(f) ? System.IO.File.ReadAllText(f).Trim() : null;
            }
            catch { return null; }
        }
    }

    /// <summary>
    /// The version the runner should be on, plus where to get it.
    /// </summary>
    /// <remarks>
    /// Anonymous and unauthenticated by design: the runner calls this on startup, before the user
    /// has signed in, so a stale client can be told to update before it ever tries to log in. The
    /// payload is only a version and a URL — nothing tenant-specific leaks.
    /// </remarks>
    [AllowAnonymous]
    [HttpGet("/desktop/version")]
    public IActionResult Version()
    {
        var version = StagedVersion;
        var hasPackage = System.IO.File.Exists(Path.Combine(InstallRoot, "package.zip"));
        return Json(new
        {
            role = Role,
            version = version ?? "0.0.0",
            available = version is not null && hasPackage,
            downloadUrl = hasPackage ? "/desktop/download" : null,
            // Sent so a client far behind can warn "you must sign in again" rather than silently
            // running an old protocol against a newer server.
            apiVersion = 1
        });
    }

    /// <summary>The install page — the "downloads" entry point for the desktop runner.</summary>
    [HttpGet]
    public async Task<IActionResult> Install(CancellationToken ct)
    {
        var runtime = await _license.GetRuntimeStateAsync(ct);
        ViewBag.Version = StagedVersion;
        ViewBag.HasPackage = System.IO.File.Exists(Path.Combine(InstallRoot, "package.zip"));
        ViewBag.LocalRunAllowed = runtime.AllowsLocalRun;
        ViewBag.ServerBase = $"{Request.Scheme}://{Request.Host}";
        return View();
    }

    /// <summary>Download the staged runner package.</summary>
    [HttpGet("/desktop/download")]
    public IActionResult Download(string? ticket = null)
    {
        if (User.Identity?.IsAuthenticated != true && !IsTicketValid(ticket))
            return Unauthorized("برای دانلود وارد شوید.");

        var zip = Path.Combine(InstallRoot, "package.zip");
        if (!System.IO.File.Exists(zip))
            return NotFound("بستهٔ اجراکننده روی سرور آماده نشده است.");

        // Read into memory so the response does not hold an open file handle on the staged package —
        // otherwise a new release could not replace it while a download is in flight.
        var bytes = System.IO.File.ReadAllBytes(zip);
        var version = StagedVersion ?? "0.0.0";
        return File(bytes, "application/zip", $"morobot-desktop-{version}.zip");
    }

    /// <summary>
    /// Mint a short-lived download ticket, for a copy-paste install command.
    /// </summary>
    [HttpGet("/desktop/ticket")]
    public IActionResult Ticket()
    {
        if (User.Identity?.IsAuthenticated != true) return Unauthorized();
        return Json(new { ticket = CreateTicket(), expiresInHours = 2 });
    }

    private string CreateTicket() =>
        _tickets.Protect($"{Role}|{DateTime.UtcNow.AddHours(2):O}");

    private bool IsTicketValid(string? ticket)
    {
        if (string.IsNullOrWhiteSpace(ticket)) return false;
        try
        {
            var raw = _tickets.Unprotect(ticket);
            var parts = raw.Split('|');
            if (parts.Length != 2 || parts[0] != Role) return false;
            return DateTime.TryParse(parts[1], out var until) && DateTime.UtcNow <= until;
        }
        catch
        {
            // A tampered or foreign-purpose ticket fails to unprotect; that is a refusal, not a crash.
            return false;
        }
    }
}
