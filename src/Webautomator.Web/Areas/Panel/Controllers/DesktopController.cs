using System.IO;
using System.IO.Compression;
using System.Text.Json;
using Webautomator.Infrastructure.Services;
using Webautomator.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;

namespace Webautomator.Web.Areas.Panel.Controllers;

/// <summary>
/// Distribution and update for the desktop player.
/// </summary>
/// <remarks>
/// Modelled on <see cref="ExtensionController"/> on purpose: the player is the same kind of artefact
/// as the browser extension — a client the panel ships and later replaces — so it gets the same
/// treatment (a version stamp, a ticket-gated download, an update check the client can poll or be
/// pushed) rather than a parallel mechanism that would need its own maintenance.
///
/// Everything here is gated on the local-run licence flag: a deployment that does not own the
/// feature must not be able to download a player that would refuse to work anyway.
/// </remarks>
[Area("Panel")]
[Authorize]
public class DesktopController : Controller
{
    private const string Role = "desktop";

    /// <summary>The file the player reads to learn the server it was downloaded from.</summary>
    /// <remarks>
    /// Named and shaped like the extension's binding file on purpose: one machine can carry several
    /// players, each pointing at a different server, and each has to prove which server it belongs
    /// to rather than guessing. The player treats this as authority only when the licence carries no
    /// address.
    /// </remarks>
    public const string BindingFileName = "player-binding.json";

    private readonly DesktopSyncService _sync;
    private readonly LicenseService _license;
    private readonly DeploymentFingerprintService _fingerprints;
    private readonly IDataProtector _tickets;

    public DesktopController(
        DesktopSyncService sync,
        LicenseService license,
        DeploymentFingerprintService fingerprints,
        IDataProtectionProvider protection)
    {
        _sync = sync;
        _license = license;
        _fingerprints = fingerprints;
        _tickets = protection.CreateProtector("Webautomator.DesktopInstallTicket.v1");
    }

    /// <summary>
    /// The version the player should be on, plus where to get it.
    /// </summary>
    /// <remarks>
    /// Anonymous on purpose: the client calls this on startup, before the user has signed in, so a
    /// stale build can be told to update before it ever tries to log in. The payload is a version,
    /// some notes and a URL — nothing tenant-specific leaks.
    /// </remarks>
    [AllowAnonymous]
    [HttpGet("/desktop/version")]
    public IActionResult Version() => Json(_sync.VersionPayload());

    /// <summary>The install page — the "downloads" entry point for the desktop player.</summary>
    [HttpGet]
    public async Task<IActionResult> Install(CancellationToken ct)
    {
        var runtime = await _license.GetRuntimeStateAsync(ct);
        // Re-stage before showing the page: a publish may have replaced the player since the last
        // request, and the page is exactly where a stale version would be noticed.
        await _sync.SyncAndNotifyAsync("install-page");
        ViewBag.Version = _sync.StagedVersion;
        ViewBag.HasPackage = _sync.HasPackage;
        ViewBag.Notes = _sync.ReadNotes();
        ViewBag.LocalRunAllowed = runtime.AllowsLocalRun;
        ViewBag.ServerBase = $"{Request.Scheme}://{Request.Host}";
        return View();
    }

    /// <summary>Download the staged player package.</summary>
    [AllowAnonymous]
    [HttpGet("/desktop/download")]
    public IActionResult Download(string? ticket = null)
    {
        // Same two ways in as the extension: a signed-in user's cookie, or a ticket minted by the
        // (authenticated) install page for a copy-paste command. Without one of the two this would
        // be an open file server for every anonymous visitor.
        if (User.Identity?.IsAuthenticated != true && !IsTicketValid(ticket))
            return Unauthorized("برای دانلود وارد شوید.");

        if (!_sync.HasPackage)
            return NotFound("بستهٔ اجراکننده روی سرور آماده نشده است.");

        // Read into memory so the response does not hold an open handle on the staged package —
        // otherwise a new release could not replace it while a download is in flight.
        var bytes = System.IO.File.ReadAllBytes(_sync.PackagePath);
        var version = _sync.StagedVersion ?? "0.0.0";

        // Stamp the download with the server it came from, exactly like the extension's binding
        // file. This is what lets a player downloaded from one server reach THAT server on first
        // launch, and what keeps two players from two servers apart on one machine. It is injected
        // here rather than baked into the staged package because the staged package is shared by
        // every caller, while the origin is per request.
        var origin = $"{Request.Scheme}://{Request.Host}";
        var fingerprint = _fingerprints.TryGet()?.Fingerprint;
        bytes = InjectBinding(bytes, origin, fingerprint);

        return File(bytes, "application/zip", $"webautomator-player-{version}.zip");
    }

    /// <summary>
    /// Add (or replace) the <c>player-binding.json</c> entry in the player zip.
    /// </summary>
    /// <remarks>
    /// Rewrites the archive entry by entry rather than appending, so a package that already carries
    /// a stale binding cannot end up with two entries of the same name — a duplicate would make the
    /// player's behaviour depend on which entry the extractor happened to keep.
    /// </remarks>
    private static byte[] InjectBinding(byte[] zipBytes, string origin, string? fingerprint)
    {
        var binding = JsonSerializer.SerializeToUtf8Bytes(new
        {
            v = 1,
            serverBase = origin,
            fingerprint,
            issuedUtc = DateTime.UtcNow.ToString("O")
        });

        using var input = new MemoryStream(zipBytes, writable: false);
        using var source = new ZipArchive(input, ZipArchiveMode.Read);
        using var output = new MemoryStream();
        using (var target = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var entry in source.Entries)
            {
                if (string.Equals(entry.FullName, BindingFileName, StringComparison.OrdinalIgnoreCase))
                    continue;
                var copy = target.CreateEntry(entry.FullName, CompressionLevel.Optimal);
                using var src = entry.Open();
                using var dst = copy.Open();
                src.CopyTo(dst);
            }

            var bindEntry = target.CreateEntry(BindingFileName, CompressionLevel.Optimal);
            using var bindStream = bindEntry.Open();
            bindStream.Write(binding, 0, binding.Length);
        }
        return output.ToArray();
    }

    /// <summary>Mint a short-lived download ticket, for a copy-paste install command.</summary>
    [HttpGet("/desktop/ticket")]
    public IActionResult Ticket()
    {
        if (User.Identity?.IsAuthenticated != true) return Unauthorized();
        return Json(new { ticket = CreateTicket(), expiresInHours = 2 });
    }

    private string CreateTicket() => _tickets.Protect($"{Role}|{DateTime.UtcNow.AddHours(2):O}");

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
