using Morobot.Contracts.Licensing;
using Morobot.Domain;
using Morobot.Infrastructure.Persistence;
using Morobot.Licensing;

namespace Morobot.Infrastructure.Services;

public sealed class BrandingService
{
    private const string DefaultAppName = "Morobot";
    private readonly SystemSettingsService _settings;
    private readonly LicenseService _license;

    public BrandingService(SystemSettingsService settings, LicenseService license)
    {
        _settings = settings;
        _license = license;
    }

    public async Task<TenantBrandingDto> GetAsync(CancellationToken ct = default)
    {
        var state = await _license.GetRuntimeStateAsync(ct);
        if (!state.AllowsBranding)
        {
            // Still honour the Admin → Branding name/logo; only the paid extras
            // (copyright-badge removal, referral-QR toggle) stay locked while unlicensed.
            var appNameFree = await _settings.GetAsync(SystemSettingKeys.BrandAppName, DefaultAppName, ct);
            var titleFree = await _settings.GetAsync(SystemSettingKeys.BrandTitle, appNameFree, ct);
            return new TenantBrandingDto
            {
                AppName = string.IsNullOrWhiteSpace(appNameFree) ? DefaultAppName : appNameFree.Trim(),
                BrandTitle = string.IsNullOrWhiteSpace(titleFree) ? null : titleFree.Trim(),
                OrganizationName = await _settings.GetAsync(SystemSettingKeys.BrandOrganization, "", ct),
                LogoUrl = await _settings.GetAsync(SystemSettingKeys.BrandLogoPath, "", ct),
                FaviconUrl = await _settings.GetAsync(SystemSettingKeys.BrandFaviconPath, "", ct),
                AppNameEn = await _settings.GetAsync(SystemSettingKeys.BrandAppNameEn, "", ct),
                AppNameFa = await _settings.GetAsync(SystemSettingKeys.BrandAppNameFa, "", ct),
                BrandTitleEn = await _settings.GetAsync(SystemSettingKeys.BrandTitleEn, "", ct),
                BrandTitleFa = await _settings.GetAsync(SystemSettingKeys.BrandTitleFa, "", ct),
                OrganizationNameEn = await _settings.GetAsync(SystemSettingKeys.BrandOrganizationEn, "", ct),
                OrganizationNameFa = await _settings.GetAsync(SystemSettingKeys.BrandOrganizationFa, "", ct),
                IsLicensedBranding = false,
                ShowReferralQrWidget = true,
                ReferralWidgetUrl = LicenseReferralUrl.TryNormalize(state.Payload?.ReferralWidgetUrl)
            };
        }

        var appName = await _settings.GetAsync(SystemSettingKeys.BrandAppName, DefaultAppName, ct);
        var title = await _settings.GetAsync(SystemSettingKeys.BrandTitle, appName, ct);
        var org = await _settings.GetAsync(SystemSettingKeys.BrandOrganization, "", ct);
        var logo = await _settings.GetAsync(SystemSettingKeys.BrandLogoPath, "", ct);
        var favicon = await _settings.GetAsync(SystemSettingKeys.BrandFaviconPath, "", ct);

        var dto = new TenantBrandingDto
        {
            AppName = string.IsNullOrWhiteSpace(appName) ? DefaultAppName : appName,
            BrandTitle = string.IsNullOrWhiteSpace(title) ? appName : title,
            OrganizationName = string.IsNullOrWhiteSpace(org) ? state.Payload?.OrganizationName : org,
            LogoUrl = string.IsNullOrWhiteSpace(logo) ? null : logo,
            FaviconUrl = string.IsNullOrWhiteSpace(favicon) ? null : favicon,
            AppNameEn = await _settings.GetAsync(SystemSettingKeys.BrandAppNameEn, "", ct),
            AppNameFa = await _settings.GetAsync(SystemSettingKeys.BrandAppNameFa, "", ct),
            BrandTitleEn = await _settings.GetAsync(SystemSettingKeys.BrandTitleEn, "", ct),
            BrandTitleFa = await _settings.GetAsync(SystemSettingKeys.BrandTitleFa, "", ct),
            OrganizationNameEn = await _settings.GetAsync(SystemSettingKeys.BrandOrganizationEn, "", ct),
            OrganizationNameFa = await _settings.GetAsync(SystemSettingKeys.BrandOrganizationFa, "", ct),
            IsLicensedBranding = true,
            ReferralWidgetUrl = LicenseReferralUrl.TryNormalize(state.Payload?.ReferralWidgetUrl)
        };
        await ApplyPaletteFromSettingsAsync(dto, ct);
        await ApplyDiagramDefaultsAsync(dto, ct);
        return dto;
    }

    /// <summary>
    /// The stored stamp of the current branding, or an empty string when none has been written yet.
    /// </summary>
    /// <remarks>
    /// One settings lookup, which is the entire point: it tells the caller whether the browser's
    /// cached copy is still current without reading the forty-odd settings that copy was built from.
    /// An install that has never saved branding returns empty, which cannot match a cookie's stamp,
    /// so the first request falls through to a full read and writes both the cookie and the stamp.
    /// </remarks>
    public Task<string> GetStampAsync(CancellationToken ct = default)
        => _settings.GetAsync(SystemSettingKeys.BrandStamp, "", ct);

    /// <summary>
    /// Record the stamp for an already-resolved branding snapshot, if none is stored yet.
    /// </summary>
    /// <remarks>
    /// This exists so an install that has never saved branding still reaches the cached path. The row
    /// is seeded (as an empty string), so the write has somewhere to land; without this call the row
    /// would stay empty, every comparison against it would fail, and the full read would run on every
    /// single page render — the exact cost the cache was added to remove.
    ///
    /// It is called only when the stamp is missing, and re-reads before writing, so the steady state
    /// performs no write at all. Two concurrent first requests may both write the same value; that is
    /// harmless because the value is derived from the branding rather than assigned, so whichever
    /// write lands last is still correct.
    /// </remarks>
    public async Task EnsureStampAsync(TenantBrandingDto dto, CancellationToken ct = default)
    {
        if (!string.IsNullOrEmpty(await GetStampAsync(ct)))
            return;

        await _settings.SetAsync(
            SystemSettingKeys.BrandStamp,
            BrandStamp.Compute(dto),
            actorUserId: null,
            actorUserName: null,
            ct);
    }

    /// <summary>
    /// Load the diagram behaviour defaults the branding page now owns.
    /// </summary>
    /// <remarks>
    /// Read straight from the settings rows by key rather than through
    /// <c>DiagramSettingsService.GetAsync</c>: that method resolves the values into the editor's
    /// camel-cased payload for flow.js, which would then have to be mapped back to setting keys to
    /// render the form. The form posts setting keys, so it reads setting keys.
    /// </remarks>
    private async Task ApplyDiagramDefaultsAsync(TenantBrandingDto dto, CancellationToken ct)
    {
        foreach (var key in SystemSettingKeys.DiagramBehaviourOwned)
            dto.DiagramDefaults[key] = await _settings.GetAsync(key, "", ct);
    }

    public async Task SaveAsync(TenantBrandingDto model, CancellationToken ct = default)
        => await SaveAsync(model, actorUserId: null, actorUserName: null, ct);

    /// <summary>
    /// Persist branding, recording who changed it.
    /// </summary>
    /// <remarks>
    /// The actor is stored on the service for the duration of the call rather than threaded
    /// through every <c>SetAsync</c>: branding writes around twenty keys one at a time, and
    /// passing the same two arguments to each would bury the values being written. The service
    /// is scoped per request, so the field cannot leak between users.
    /// </remarks>
    public async Task SaveAsync(
        TenantBrandingDto model,
        int? actorUserId,
        string? actorUserName,
        CancellationToken ct = default)
    {
        _actorUserId = actorUserId;
        _actorUserName = actorUserName;
        try
        {
            await SaveCoreAsync(model, ct);
        }
        finally
        {
            _actorUserId = null;
            _actorUserName = null;
        }
    }

    /// <summary>Actor for the current save; null for system-initiated writes (licence import).</summary>
    private int? _actorUserId;
    private string? _actorUserName;

    private async Task SetTrackedAsync(string key, string value, CancellationToken ct)
        => await _settings.SetAsync(key, value, _actorUserId, _actorUserName, ct);

    private async Task SaveCoreAsync(TenantBrandingDto model, CancellationToken ct)
    {
        var state = await _license.GetRuntimeStateAsync(ct);
        if (!state.AllowsBranding)
            throw new InvalidOperationException("branding.error.notLicensed");

        // The per-language values are what the page edits. The legacy single-value rows
        // (BrandAppName / BrandTitle / BrandOrganization) are deliberately NOT written here: the
        // form no longer posts them, so writing would blank them with the model's default, and they
        // are the last-resort fallback for an install whose only value is the old one. They keep
        // whatever they already held.
        await SetTrackedAsync(SystemSettingKeys.BrandAppNameEn, model.AppNameEn ?? "", ct);
        await SetTrackedAsync(SystemSettingKeys.BrandAppNameFa, model.AppNameFa ?? "", ct);
        await SetTrackedAsync(SystemSettingKeys.BrandTitleEn, model.BrandTitleEn ?? "", ct);
        await SetTrackedAsync(SystemSettingKeys.BrandTitleFa, model.BrandTitleFa ?? "", ct);
        await SetTrackedAsync(SystemSettingKeys.BrandOrganizationEn, model.OrganizationNameEn ?? "", ct);
        await SetTrackedAsync(SystemSettingKeys.BrandOrganizationFa, model.OrganizationNameFa ?? "", ct);
        if (!string.IsNullOrWhiteSpace(model.LogoUrl))
            await SetTrackedAsync(SystemSettingKeys.BrandLogoPath, model.LogoUrl, ct);
        if (!string.IsNullOrWhiteSpace(model.FaviconUrl))
            await SetTrackedAsync(SystemSettingKeys.BrandFaviconPath, model.FaviconUrl, ct);
        await SavePaletteAsync(model, ct);
        await SaveDiagramColorsAsync(model, ct);

        // Written last, from what was just stored, so the stamp always describes the saved state.
        // Computing it from the posted model instead would stamp the pre-normalisation values, and a
        // colour the service corrected (an invalid hex falls back to the shipped default) would leave
        // a stamp that never matches the data it claims to describe.
        var saved = await GetAsync(ct);
        await SetTrackedAsync(
            SystemSettingKeys.BrandStamp,
            BrandStamp.Compute(saved),
            ct);
    }

    private async Task ApplyPaletteFromSettingsAsync(TenantBrandingDto dto, CancellationToken ct)
    {        dto.ColorPrimary = BrandPaletteDefaults.NormalizeHex(
            await _settings.GetAsync(SystemSettingKeys.BrandColorPrimary, BrandPaletteDefaults.Primary, ct),
            BrandPaletteDefaults.Primary);
        dto.ColorPrimaryDark = BrandPaletteDefaults.NormalizeHex(
            await _settings.GetAsync(SystemSettingKeys.BrandColorPrimaryDark, BrandPaletteDefaults.PrimaryDark, ct),
            BrandPaletteDefaults.PrimaryDark);
        dto.ColorPrimaryLight = BrandPaletteDefaults.NormalizeHex(
            await _settings.GetAsync(SystemSettingKeys.BrandColorPrimaryLight, BrandPaletteDefaults.PrimaryLight, ct),
            BrandPaletteDefaults.PrimaryLight);
        dto.ColorAccent = BrandPaletteDefaults.NormalizeHex(
            await _settings.GetAsync(SystemSettingKeys.BrandColorAccent, BrandPaletteDefaults.Accent, ct),
            BrandPaletteDefaults.Accent);
        dto.ColorSoft = BrandPaletteDefaults.NormalizeHex(
            await _settings.GetAsync(SystemSettingKeys.BrandColorSoft, BrandPaletteDefaults.Soft, ct),
            BrandPaletteDefaults.Soft);
        dto.ColorSoft2 = BrandPaletteDefaults.NormalizeHex(
            await _settings.GetAsync(SystemSettingKeys.BrandColorSoft2, BrandPaletteDefaults.Soft2, ct),
            BrandPaletteDefaults.Soft2);
        dto.ColorInk = BrandPaletteDefaults.NormalizeHex(
            await _settings.GetAsync(SystemSettingKeys.BrandColorInk, BrandPaletteDefaults.Ink, ct),
            BrandPaletteDefaults.Ink);
        dto.ColorBorderSubtle = BrandPaletteDefaults.NormalizeHex(
            await _settings.GetAsync(SystemSettingKeys.BrandColorBorderSubtle, BrandPaletteDefaults.BorderSubtle, ct),
            BrandPaletteDefaults.BorderSubtle);
        var qrRaw = await _settings.GetAsync(SystemSettingKeys.BrandReferralQrVisible, "true", ct);
        dto.ShowReferralQrWidget = !string.Equals(qrRaw, "false", StringComparison.OrdinalIgnoreCase)
                                   && qrRaw != "0";
        dto.FrontShowSite = await _settings.GetAsync(SystemSettingKeys.FrontShowSite, "false", ct);

        await ApplyDiagramColorsAsync(dto, ct);
    }

    /// <summary>
    /// Read every diagram colour into the model, falling back to the shipped default.
    /// </summary>
    /// <remarks>
    /// The list of colours comes from <c>SystemSettingKeys.DiagramColors</c>, so a colour added
    /// there is read, rendered and saved with no change here. The shipped default is the fallback
    /// rather than an empty string, which is what makes the reset button on the page restore a real
    /// colour instead of clearing the field.
    /// </remarks>
    private async Task ApplyDiagramColorsAsync(TenantBrandingDto dto, CancellationToken ct)
    {
        foreach (var color in SystemSettingKeys.DiagramColors)
        {
            var raw = await _settings.GetAsync(color.Key, color.DefaultValue, ct);
            dto.DiagramColors[color.Key] = BrandPaletteDefaults.NormalizeHex(raw, color.DefaultValue);
        }
    }

    /// <summary>Persist every diagram colour, normalising each to a usable hex.</summary>
    private async Task SaveDiagramColorsAsync(TenantBrandingDto model, CancellationToken ct)
    {
        foreach (var color in SystemSettingKeys.DiagramColors)
        {
            model.DiagramColors.TryGetValue(color.Key, out var submitted);
            await SetTrackedAsync(color.Key, BrandPaletteDefaults.NormalizeHex(submitted, color.DefaultValue), ct);
        }
    }

    /// <summary>
    /// Restore one colour to the value the product ships.
    /// </summary>
    /// <remarks>
    /// This is what replaced the old per-colour "apply" switches. Instead of a second setting that
    /// decided whether the first one was honoured, the stored value itself is put back — one source
    /// of truth, and the admin sees the restored colour rather than a switch flipping.
    /// Returns false when the key is not a diagram colour, so the caller can answer 404 rather than
    /// silently writing a row for a key that does not exist.
    /// </remarks>
    public async Task<bool> ResetDiagramColorAsync(
        string key, int? actorUserId, string? actorUserName, CancellationToken ct = default)
    {
        var fallback = SystemSettingKeys.DiagramColorDefault(key);
        if (fallback is null) return false;

        _actorUserId = actorUserId;
        _actorUserName = actorUserName;
        try
        {
            await SetTrackedAsync(key, fallback, ct);
        }
        finally
        {
            _actorUserId = null;
            _actorUserName = null;
        }
        return true;
    }

    private async Task SavePaletteAsync(TenantBrandingDto model, CancellationToken ct)
    {
        await SetTrackedAsync(SystemSettingKeys.BrandColorPrimary,
            BrandPaletteDefaults.NormalizeHex(model.ColorPrimary, BrandPaletteDefaults.Primary), ct);
        await SetTrackedAsync(SystemSettingKeys.BrandColorPrimaryDark,
            BrandPaletteDefaults.NormalizeHex(model.ColorPrimaryDark, BrandPaletteDefaults.PrimaryDark), ct);
        await SetTrackedAsync(SystemSettingKeys.BrandColorPrimaryLight,
            BrandPaletteDefaults.NormalizeHex(model.ColorPrimaryLight, BrandPaletteDefaults.PrimaryLight), ct);
        await SetTrackedAsync(SystemSettingKeys.BrandColorAccent,
            BrandPaletteDefaults.NormalizeHex(model.ColorAccent, BrandPaletteDefaults.Accent), ct);
        await SetTrackedAsync(SystemSettingKeys.BrandColorSoft,
            BrandPaletteDefaults.NormalizeHex(model.ColorSoft, BrandPaletteDefaults.Soft), ct);
        await SetTrackedAsync(SystemSettingKeys.BrandColorSoft2,
            BrandPaletteDefaults.NormalizeHex(model.ColorSoft2, BrandPaletteDefaults.Soft2), ct);
        await SetTrackedAsync(SystemSettingKeys.BrandColorInk,
            BrandPaletteDefaults.NormalizeHex(model.ColorInk, BrandPaletteDefaults.Ink), ct);
        await SetTrackedAsync(SystemSettingKeys.BrandColorBorderSubtle,
            BrandPaletteDefaults.NormalizeHex(model.ColorBorderSubtle, BrandPaletteDefaults.BorderSubtle), ct);
        await SetTrackedAsync(SystemSettingKeys.BrandReferralQrVisible,
            model.ShowReferralQrWidget ? "true" : "false", ct);
    }
}
