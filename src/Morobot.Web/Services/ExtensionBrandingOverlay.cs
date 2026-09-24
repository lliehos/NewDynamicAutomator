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
    private readonly ILogger<ExtensionBrandingOverlay> _log;

    public ExtensionBrandingOverlay(TenantBrandingViewService branding, ILogger<ExtensionBrandingOverlay> log)
    {
        _branding = branding;
        _log = log;
    }

    public async Task ApplyToInstallRootsAsync(IEnumerable<string> installRoots, CancellationToken ct = default)
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
                PatchManifest(root, head);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Extension branding overlay failed for {Root}", root);
            }
        }
    }

    private static void PatchManifest(string installRoot, BrandHeadModel head)
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

        // Always apply the tenant's Admin → Branding name; the licence only gates
        // the extra paid surface (copyright badge, referral QR).
        obj["name"] = $"{head.AppName} Global";
        obj["description"] = $"{head.BrandTitle} — ضبط، اجرا و سلکتور";
        if (obj["action"] is JsonObject action)
            action["default_title"] = $"{head.AppName} — {head.BrandTitle}";

        File.WriteAllText(manifestPath, obj.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    public async Task ApplySmartRecorderAsync(string? installRoot, BrandHeadModel head, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(installRoot) || !Directory.Exists(installRoot)) return;
        var origin = _branding.ResolveSiteOrigin();
        var smartName = $"{head.AppName} Smart Recorder";
        var json = JsonSerializer.Serialize(head.ToExtensionJson(origin), new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(Path.Combine(installRoot, "morobot-branding.json"), json, ct);

        var manifestPath = Path.Combine(installRoot, "manifest.json");
        if (!File.Exists(manifestPath)) return;
        try
        {
            var root = JsonNode.Parse(File.ReadAllText(manifestPath)) as JsonObject;
            if (root == null) return;
            root["name"] = smartName;
            root["description"] = $"{head.BrandTitle} — Smart Recorder";
            if (root["action"] is JsonObject action)
                action["default_title"] = $"{head.AppName} — Smart Recorder";
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
        await ApplyToInstallRootsAsync(new[] { sync.InstallPathFor(ExtensionSyncService.RoleGlobal) }, ct);
        await ApplySmartRecorderAsync(sync.InstallPathFor(ExtensionSyncService.RoleSmart), head, ct);
    }
}
