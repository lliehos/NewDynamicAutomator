using System.Text.Json;
using System.Text.Json.Nodes;
using Morobot.Web.Models;

namespace Morobot.Web.Services;

/// <summary>
/// Writes tenant branding into synced extension install folders (manifest + morobot-branding.json).
/// </summary>
public sealed class ExtensionBrandingOverlay
{
    private readonly TenantBrandingViewService _branding;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<ExtensionBrandingOverlay> _log;

    public ExtensionBrandingOverlay(TenantBrandingViewService branding, IWebHostEnvironment env, ILogger<ExtensionBrandingOverlay> log)
    {
        _branding = branding;
        _env = env;
        _log = log;
    }

    public async Task ApplyToInstallRootsAsync(IEnumerable<string> installRoots, CancellationToken ct = default, string? identityLabel = null)
    {
        var head = await _branding.GetHeadAsync(ct);
        var origin = _branding.ResolveSiteOrigin();
        var payload = head.ToExtensionJson(origin);
        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });

        foreach (var root in installRoots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
                continue;
            try
            {
                var brandingPath = Path.Combine(root, "morobot-branding.json");
                await File.WriteAllTextAsync(brandingPath, json, ct);
                PatchManifest(root, head, identityLabel);
                CopyBrandIcons(root, head);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Extension branding overlay failed for {Root}", root);
            }
        }
    }

    /**
     * The identity part of the extension's own name, so two installations on one machine are not
     * identical twins in chrome://extensions. "default" is not an identity and stays unsuffixed.
     */
    private static string IdentitySuffix(string? identityLabel)
        => string.IsNullOrWhiteSpace(identityLabel)
           || identityLabel.Equals("default", StringComparison.OrdinalIgnoreCase)
            ? ""
            : $" — {identityLabel}";

    private static void PatchManifest(string installRoot, BrandHeadModel head, string? identityLabel)
    {
        var manifestPath = Path.Combine(installRoot, "manifest.json");
        if (!File.Exists(manifestPath)) return;

        JsonNode? root;
        try
        {
            root = JsonNode.Parse(File.ReadAllText(manifestPath));
        }
        catch
        {
            return;
        }

        if (root is not JsonObject obj) return;

        var suffix = IdentitySuffix(identityLabel);
        // Always apply the tenant's Admin → Branding name; the licence only gates
        // the extra paid surface (copyright badge, referral QR).
        obj["name"] = $"{head.AppName} Global{suffix}";
        obj["description"] = $"{head.BrandTitle} — ضبط، اجرا و سلکتور";
        if (obj["action"] is JsonObject action)
            action["default_title"] = $"{head.AppName} — {head.BrandTitle}{suffix}";

        File.WriteAllText(manifestPath, obj.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>
    /// Give the extension the panel's own icon.
    ///
    /// The manifest points at icons/icon16|32|48|128.png; this overwrites those four files with the
    /// tenant's brand icon so the toolbar button and the extensions page show the same mark as the
    /// web panel. The web icon is always a PNG — BrandHeadModel falls back to the stock PNG whenever
    /// the tenant's favicon is not one, and Chrome accepts no other format for manifest icons.
    /// </summary>
    private void CopyBrandIcons(string installRoot, BrandHeadModel head)
    {
        var source = ResolveBrandIconFile(head);
        if (source is null) return;
        try
        {
            var iconsDir = Path.Combine(installRoot, "icons");
            Directory.CreateDirectory(iconsDir);
            foreach (var size in new[] { 16, 32, 48, 128 })
            {
                File.Copy(source, Path.Combine(iconsDir, $"icon{size}.png"), overwrite: true);
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Brand icon copy failed for {Root}", installRoot);
        }
    }

    private string? ResolveBrandIconFile(BrandHeadModel head)
    {
        var webPath = string.IsNullOrWhiteSpace(head.IconPngPath) ? BrandHeadModel.DefaultIconPngPath : head.IconPngPath;
        if (!webPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) return null;
        try
        {
            var rel = webPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var full = Path.GetFullPath(Path.Combine(_env.WebRootPath, rel));
            var rootFull = Path.GetFullPath(_env.WebRootPath);
            // Only files inside wwwroot may be copied — the path originates in settings, not code.
            if (!full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) return null;
            return File.Exists(full) ? full : null;
        }
        catch
        {
            return null;
        }
    }

    public async Task ApplySmartRecorderAsync(string? installRoot, BrandHeadModel head, CancellationToken ct = default, string? identityLabel = null)
    {
        if (string.IsNullOrWhiteSpace(installRoot) || !Directory.Exists(installRoot)) return;
        var origin = _branding.ResolveSiteOrigin();
        var suffix = IdentitySuffix(identityLabel);
        var smartName = $"{head.AppName} Smart Recorder{suffix}";
        var json = JsonSerializer.Serialize(head.ToExtensionJson(origin), new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(Path.Combine(installRoot, "morobot-branding.json"), json, ct);
        CopyBrandIcons(installRoot, head);

        var manifestPath = Path.Combine(installRoot, "manifest.json");
        if (!File.Exists(manifestPath)) return;
        try
        {
            var root = JsonNode.Parse(File.ReadAllText(manifestPath)) as JsonObject;
            if (root == null) return;
            root["name"] = smartName;
            root["description"] = $"{head.BrandTitle} — Smart Recorder";
            if (root["action"] is JsonObject action)
                action["default_title"] = $"{head.AppName} — Smart Recorder{suffix}";
            File.WriteAllText(manifestPath, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Smart recorder manifest branding patch failed");
        }
    }

    public async Task ApplyAllPackagesAsync(ExtensionSyncService sync, CancellationToken ct = default)
    {
        var head = await _branding.GetHeadAsync(ct);
        // The identity this deployment uses in its paths is the same one its extensions carry in
        // their names — so a machine with two panels can tell the two extensions apart.
        var identity = sync.AppInstanceKey;
        await ApplyToInstallRootsAsync(new[] { sync.InstallPathFor(ExtensionSyncService.RoleGlobal) }, ct, identity);
        await ApplySmartRecorderAsync(sync.InstallPathFor(ExtensionSyncService.RoleSmart), head, ct, identity);
    }
}
