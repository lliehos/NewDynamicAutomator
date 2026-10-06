using System.IO.Compression;
using System.Text;
using Morobot.Infrastructure.Options;
using Morobot.Infrastructure.Services;
using Morobot.Web.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;

namespace Morobot.Web.Areas.Panel.Controllers;

[Area("Panel")]
[Authorize]
public class ExtensionController : Controller
{
    private readonly IWebHostEnvironment _env;
    private readonly ExtensionSyncService _sync;
    private readonly TenantBrandingViewService _branding;
    private readonly DeploymentFingerprintService _fingerprints;
    private readonly IDataProtector _tickets;

    public ExtensionController(IWebHostEnvironment env, ExtensionSyncService sync, TenantBrandingViewService branding, DeploymentFingerprintService fingerprints, IDataProtectionProvider protection)
    {
        _env = env;
        _sync = sync;
        _branding = branding;
        _fingerprints = fingerprints;
        // Purpose-scoped protector for short-lived "install tickets" — the token a download script
        // uses so it can fetch the package without a browser cookie. Data Protection is already
        // registered (TempData/cookies use it); the purpose string keeps these tokens from being
        // interchangeable with anything else it protects.
        _tickets = protection.CreateProtector("Morobot.ExtensionInstallTicket.v1");
    }

    [AllowAnonymous]
    [HttpGet("/extension/dev-stamp")]
    [HttpGet("/extension/dev-stamp/{role}")]
    public IActionResult DevStamp(string? role = null)
    {
        // Bare /extension/dev-stamp → combined stamp so either package change
        // wakes older extension builds that still poll the unscoped URL.
        if (string.IsNullOrWhiteSpace(role))
        {
            if (!_env.IsDevelopment()
                && !Directory.Exists(_sync.InstallPathFor(ExtensionSyncService.RoleRecorder))
                && !Directory.Exists(_sync.InstallPathFor(ExtensionSyncService.RolePlayer))
                && !Directory.Exists(_sync.InstallPathFor(ExtensionSyncService.RoleSelector))
                && !Directory.Exists(_sync.InstallPathFor(ExtensionSyncService.RoleSmart)))
                return NotFound();

            var rec = _sync.GetStamp(ExtensionSyncService.RoleRecorder, syncFirst: true);
            var play = _sync.GetStamp(ExtensionSyncService.RolePlayer, syncFirst: true);
            var sel = _sync.GetStamp(ExtensionSyncService.RoleSelector, syncFirst: true);
            var smart = _sync.GetStamp(ExtensionSyncService.RoleSmart, syncFirst: true);
            var combined = $"{rec.Stamp}|{play.Stamp}|{sel.Stamp}|{smart.Stamp}";
            return Json(new
            {
                stamp = combined,
                bootId = ExtensionSyncService.BootId,
                version = $"{rec.Version}+{play.Version}+{sel.Version}+{smart.Version}",
                path = play.InstallPath,
                source = play.SourcePath,
                role = "combined",
                recorder = new { stamp = rec.Stamp, version = rec.Version, path = rec.InstallPath },
                player = new { stamp = play.Stamp, version = play.Version, path = play.InstallPath },
                selector = new { stamp = sel.Stamp, version = sel.Version, path = sel.InstallPath },
                smart = new { stamp = smart.Stamp, version = smart.Version, path = smart.InstallPath }
            });
        }

        var install = _sync.InstallPathFor(role);
        if (!_env.IsDevelopment() && !Directory.Exists(install))
            return NotFound();

        var info = _sync.GetStamp(role, syncFirst: true);
        return Json(new
        {
            stamp = info.Stamp,
            bootId = info.BootId,
            version = info.Version,
            path = info.InstallPath,
            source = info.SourcePath,
            role = info.Role
        });
    }

    [AllowAnonymous]
    [HttpGet("/extension/fingerprint")]
    public IActionResult Fingerprint()
    {
        // The extension's identity probe: it fetches this from a candidate portal and only adopts
        // that portal when the fingerprint matches the one written into its install folder. No
        // caching anywhere — a stale answer is exactly the confusion this endpoint removes.
        Response.Headers.CacheControl = "no-store, max-age=0";
        var fp = _fingerprints.TryGet();
        if (fp is null)
            return Json(new { ok = false });
        return Json(new
        {
            ok = true,
            fingerprint = fp.Fingerprint,
            instanceId = fp.InstanceId,
            appInstanceKey = fp.AppInstanceKey
        });
    }

    [AllowAnonymous]
    [HttpGet("/extension/branding")]
    public async Task<IActionResult> BrandingJson(CancellationToken ct)
    {
        var head = await _branding.GetHeadAsync(ct);
        var origin = _branding.ResolveSiteOrigin();
        return Json(head.ToExtensionJson(origin));
    }

    [AllowAnonymous]
    [HttpGet("/extension/install-path")]
    public async Task<IActionResult> InstallPathInfo(CancellationToken ct)
    {
        var head = await _branding.GetHeadAsync(ct);
        return Json(_sync.InstallPathsPayload(head.ToExtensionJson(_branding.ResolveSiteOrigin())));
    }

    [AllowAnonymous]
    [HttpPost("/extension/sync")]
    public IActionResult Sync()
    {
        var result = _sync.SyncNow("api");
        return Json(_sync.InstallPathsPayload());
    }

    /// <summary>
    /// Download the package as a zip.
    ///
    /// Two ways in, because there are two callers. A signed-in user clicking the button sends the
    /// auth cookie; the install script running on the user's own machine has no cookie, so it
    /// carries a short-lived install ticket minted by the (authenticated) install page instead.
    /// Without one of the two this would be an open file server for every anonymous visitor.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("/extension/download/{role?}")]
    public IActionResult Download(string? role = null, string? ticket = null)
    {
        role ??= ExtensionSyncService.RoleRecorder;
        if (User.Identity?.IsAuthenticated != true && !IsInstallTicketValid(role, ticket))
            return Unauthorized("برای دانلود بسته وارد شوید یا از اسکریپت نصب استفاده کنید.");

        _sync.SyncRole(role, "download");
        var install = _sync.InstallPathFor(role);
        var source = Directory.Exists(install) ? install : _sync.SourcePathFor(role);
        if (source is null || !Directory.Exists(source))
            return NotFound("پوشه افزونه پیدا نشد.");

        var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(source, file).Replace('\\', '/');
                if (rel.StartsWith(".", StringComparison.Ordinal)) continue;
                zip.CreateEntryFromFile(file, rel, CompressionLevel.Optimal);
            }
        }
        ms.Position = 0;
        // The version is read from the package that was just synced, so the file the browser saves
        // is named after the exact build inside it — otherwise every release lands in the user's
        // Downloads folder under the same name and the older one is silently overwritten.
        var version = _sync.GetStamp(role, syncFirst: false).Version;
        return File(ms, "application/zip", PackageFileName(role, version));
    }

    /// <summary>
    /// The auto-installer script: downloads the package and extracts it into the conventional
    /// folder on the USER's machine (`%LOCALAPPDATA%\webautomator\…`), then opens it.
    ///
    /// This exists because the server physically cannot do that step. In Production the browser is
    /// on a different computer from the app, so the sync folder — perfect in the local case — is
    /// meaningless to the reader; and no web page may write into the user's disk on its own. A
    /// script the user runs locally (taken from this page, while signed in) is the closest a
    /// browser-delivered install gets to "automatic": one paste, no zip handling, and the same
    /// fixed path every time so a later update re-fills the folder Chrome already loaded.
    ///
    /// Ticket-gated: the request must carry a ticket minted for this role by the install page.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("/extension/installer/{role}")]
    public IActionResult Installer(string role, string? ticket = null)
    {
        if (!IsInstallTicketValid(role, ticket)) return Unauthorized("لینک نصب نامعتبر یا منقضی شده است — صفحهٔ نصب پرتال را دوباره باز کنید.");
        var script = BuildInstallerScript(role, ticket!, $"{Request.Scheme}://{Request.Host}");
        // UTF-8 WITH BOM: Windows PowerShell 5.1 reads .ps1 as ANSI unless the BOM says otherwise,
        // and the Persian messages in the script would come out as mojibake in its console.
        // NOTE: GetBytes() never emits the preamble — it must be prepended explicitly.
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(script)).ToArray();
        return File(bytes, "text/plain; charset=utf-8", $"install-{CanonicalRole(role)}.ps1");
    }

    private const int InstallTicketLifetimeHours = 2;

    /// <summary>
    /// Mint a ticket for one package role. The role is INSIDE the protected payload, so a ticket
    /// handed out for Global cannot be replayed to fetch Smart (or anything else the endpoint is
    /// ever extended to serve).
    /// </summary>
    private string CreateInstallTicket(string role)
    {
        var expiry = DateTimeOffset.UtcNow.AddHours(InstallTicketLifetimeHours).ToUnixTimeSeconds();
        return _tickets.Protect($"{CanonicalRole(role)}|{expiry}");
    }

    private bool IsInstallTicketValid(string role, string? ticket)
    {
        if (string.IsNullOrWhiteSpace(ticket)) return false;
        try
        {
            var parts = _tickets.Unprotect(ticket).Split('|');
            if (parts.Length != 2) return false;
            if (!string.Equals(parts[0], CanonicalRole(role), StringComparison.Ordinal)) return false;
            return long.TryParse(parts[1], out var expiry) && expiry >= DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        }
        catch
        {
            // Tampered or protected with a previous key ring: treat exactly like an expired one.
            return false;
        }
    }

    /// <summary>
    /// Roles collapse to the two packages that actually exist. recorder/player/selector are all
    /// aliases of the single Global package (see <c>ExtensionSyncService.ResolveRole</c>), so one
    /// ticket serves whichever alias name the caller used.
    /// </summary>
    private static string CanonicalRole(string? role)
    {
        var key = (role ?? "").Trim().ToLowerInvariant();
        if (key is "smart" or "smart-recorder" or "smartrecorder" or "ai" or "learn") return "smart";
        return "global";
    }

    /// <summary>
    /// The zip name handed to the browser, version included (e.g. <c>morobot-global-1.4.2.zip</c>).
    /// Callers that reach the same package through different role aliases still get one name because
    /// the role is canonicalised first, and the version is sanitised because it comes from the
    /// extension manifest and ends up in both a file name and a Content-Disposition header.
    /// </summary>
    private static string PackageFileName(string? role, string? version)
    {
        var baseName = CanonicalRole(role) == "smart" ? "morobot-smart-recorder" : "morobot-global";
        var suffix = SanitizeVersion(version);
        return suffix.Length == 0 ? $"{baseName}.zip" : $"{baseName}-{suffix}.zip";
    }

    private static string SanitizeVersion(string? version)
    {
        if (string.IsNullOrWhiteSpace(version)) return "";
        var sb = new StringBuilder(version.Length);
        foreach (var ch in version.Trim())
        {
            if (char.IsAsciiLetterOrDigit(ch) || ch is '.' or '-' or '_') sb.Append(ch);
        }
        return sb.ToString();
    }

    /// <summary>
    /// The script body. Kept as one raw string so the PowerShell is readable exactly as the user
    /// receives it — interpolated values (base URL, ticket, paths) are inlined, everything else is
    /// literal.
    /// </summary>
    private string BuildInstallerScript(string role, string ticket, string baseUrl)
    {
        var canonical = CanonicalRole(role);
        var leaf = Path.GetFileName(_sync.InstallPathFor(canonical));
        var keySegment = MorobotOptions.IsDefaultAppInstanceKey(_sync.AppInstanceKey) ? null : _sync.AppInstanceKey;
        var target = keySegment is null
            ? $"webautomator\\{leaf}"
            : $"webautomator\\{keySegment}\\{leaf}";
        var zip = canonical == "smart" ? "morobot-smart-recorder.zip" : "morobot-global.zip";
        return $$"""
            # ==============================================================================
            #  نصب / به‌روزرسانی خودکار افزونه — روی همین کامپیوتر اجرا کنید
            #  اجرا: راست‌کلیک روی فایل → Run with PowerShell  (یا در PowerShell:  .\این‌فایل.ps1 )
            # ==============================================================================
            $ErrorActionPreference = 'Stop'
            $base   = '{{baseUrl}}'
            $ticket = '{{ticket}}'
            $target = Join-Path $env:LOCALAPPDATA '{{target}}'
            $zip    = Join-Path $env:TEMP '{{zip}}'

            Write-Host 'دریافت بستهٔ افزونه از سرور…'
            New-Item -ItemType Directory -Force -Path $target | Out-Null
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri "$base/extension/download/{{canonical}}?ticket=$ticket" -OutFile $zip -UseBasicParsing

            Write-Host 'استخراج در مسیر نصب…'
            Expand-Archive -Path $zip -DestinationPath $target -Force
            Remove-Item $zip -Force -ErrorAction SilentlyContinue

            Write-Host ''
            Write-Host 'نصب شد:' -NoNewline; Write-Host " $target" -ForegroundColor Green
            Write-Host 'گام بعدی: chrome://extensions → Developer mode → Load unpacked → همین پوشه را انتخاب کنید.'
            Write-Host '(برای به‌روزرسانی در آینده، همین اسکریپت یا دستور را دوباره اجرا کنید.)'
            Start-Process explorer.exe $target
            """;
    }

    [HttpGet]
    public IActionResult Install()
    {
        _sync.SyncNow("install-page");
        ViewBag.GlobalPath = _sync.InstallPathFor(ExtensionSyncService.RoleGlobal);
        ViewBag.GlobalVersion = _sync.GetStamp(ExtensionSyncService.RoleGlobal, syncFirst: false).Version;
        ViewBag.RecorderPath = ViewBag.GlobalPath;
        ViewBag.PlayerPath = ViewBag.GlobalPath;
        ViewBag.SelectorPath = ViewBag.GlobalPath;
        ViewBag.SmartPath = _sync.InstallPathFor(ExtensionSyncService.RoleSmart);
        ViewBag.RecorderVersion = ViewBag.GlobalVersion;
        ViewBag.PlayerVersion = ViewBag.GlobalVersion;
        ViewBag.SelectorVersion = ViewBag.GlobalVersion;
        ViewBag.SmartVersion = _sync.GetStamp(ExtensionSyncService.RoleSmart, syncFirst: false).Version;
        ViewBag.AppInstanceKey = _sync.AppInstanceKey;
        // A key segment belongs in the path only when an explicit key is set; the normal
        // one-deployment-per-server install has none, and "default" must not leak into instructions.
        ViewBag.InstanceKeySegment = MorobotOptions.IsDefaultAppInstanceKey(_sync.AppInstanceKey)
            ? null
            : _sync.AppInstanceKey;
        // The extension↔server pairing identity — the SAME host fingerprint the licence shows, so
        // support can compare the number here with Admin → Licence (short form for readability;
        // morobot-binding.json carries the full value).
        ViewBag.BindingFingerprint = _fingerprints.TryGet() is { } fpInfo
            ? ServerHostFingerprint.ShortHash(fpInfo.Fingerprint)
            : null;
        // For the remote case: the absolute base the reader reached us by, and a short-lived
        // ticket per package so the copied command / downloaded script can fetch the zip without
        // a browser cookie. Rendered only in the non-local branch of the view.
        ViewBag.ServerBase = $"{Request.Scheme}://{Request.Host}";
        ViewBag.InstallTicketGlobal = CreateInstallTicket("global");
        ViewBag.InstallTicketSmart = CreateInstallTicket("smart");
        /*
         * Whether to hand out the folder path instead of a download package.
         *
         * Only meaningful when the browser and the server are the SAME machine, because the folder
         * lives on whatever machine runs this app. In Development that is the developer's own PC, so
         * the path is real and saving a download round-trip is convenient. In Production the server
         * is a different computer from the user's, the path does not exist for them, and the package
         * download is the only thing that can work.
         *
         * The check is deliberately "is the request local" rather than `IsDevelopment()`. The
         * environment name is not a reliable signal here - a machine can run with an unrelated
         * profile name (this one uses `UpdateServerDatabase`), and a developer may reach a locally
         * running app through localhost from the same box while the environment is not Development.
         * Testing the actual host answers the only question that matters: can this browser see that
         * folder?
         */
        ViewBag.ShowLocalPath = _env.IsDevelopment() && IsLocalRequest();
        ViewBag.IsDev = _env.IsDevelopment();
        // Only populated for the local case; the view does not render these otherwise.
        ViewBag.GlobalPath = _sync.InstallPathFor(ExtensionSyncService.RoleGlobal);
        ViewBag.SmartPath = _sync.InstallPathFor(ExtensionSyncService.RoleSmart);
        ViewBag.ExtensionPath = ViewBag.GlobalPath;
        ViewBag.Version = ViewBag.GlobalVersion;
        return View();
    }

    /// <summary>
    /// Whether this request came from the machine the app is running on.
    ///
    /// A loopback host means the browser and the server are the same computer, which is the only
    /// situation where the server's extension folder is a usable path for the person reading the
    /// page.
    /// </summary>
    private bool IsLocalRequest()
    {
        var host = Request.Host.Host;
        if (string.IsNullOrWhiteSpace(host)) return false;
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)) return true;
        if (System.Net.IPAddress.TryParse(host, out var ip))
            return System.Net.IPAddress.IsLoopback(ip);
        return false;
    }
}
