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
        return dto;
    }

    public async Task SaveAsync(TenantBrandingDto model, CancellationToken ct = default)
    {
        var state = await _license.GetRuntimeStateAsync(ct);
        if (!state.AllowsBranding)
            throw new InvalidOperationException("branding.error.notLicensed");

        await _settings.SetAsync(SystemSettingKeys.BrandAppName, model.AppName, ct);
        await _settings.SetAsync(SystemSettingKeys.BrandTitle, model.BrandTitle, ct);
        await _settings.SetAsync(SystemSettingKeys.BrandOrganization, model.OrganizationName ?? "", ct);
        await _settings.SetAsync(SystemSettingKeys.BrandAppNameEn, model.AppNameEn ?? "", ct);
        await _settings.SetAsync(SystemSettingKeys.BrandAppNameFa, model.AppNameFa ?? "", ct);
        await _settings.SetAsync(SystemSettingKeys.BrandTitleEn, model.BrandTitleEn ?? "", ct);
        await _settings.SetAsync(SystemSettingKeys.BrandTitleFa, model.BrandTitleFa ?? "", ct);
        await _settings.SetAsync(SystemSettingKeys.BrandOrganizationEn, model.OrganizationNameEn ?? "", ct);
        await _settings.SetAsync(SystemSettingKeys.BrandOrganizationFa, model.OrganizationNameFa ?? "", ct);
        if (!string.IsNullOrWhiteSpace(model.LogoUrl))
            await _settings.SetAsync(SystemSettingKeys.BrandLogoPath, model.LogoUrl, ct);
        if (!string.IsNullOrWhiteSpace(model.FaviconUrl))
            await _settings.SetAsync(SystemSettingKeys.BrandFaviconPath, model.FaviconUrl, ct);
        await SavePaletteAsync(model, ct);
    }

    private async Task ApplyPaletteFromSettingsAsync(TenantBrandingDto dto, CancellationToken ct)
    {
        dto.ColorPrimary = BrandPaletteDefaults.NormalizeHex(
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
    }

    private async Task SavePaletteAsync(TenantBrandingDto model, CancellationToken ct)
    {
        await _settings.SetAsync(SystemSettingKeys.BrandColorPrimary,
            BrandPaletteDefaults.NormalizeHex(model.ColorPrimary, BrandPaletteDefaults.Primary), ct);
        await _settings.SetAsync(SystemSettingKeys.BrandColorPrimaryDark,
            BrandPaletteDefaults.NormalizeHex(model.ColorPrimaryDark, BrandPaletteDefaults.PrimaryDark), ct);
        await _settings.SetAsync(SystemSettingKeys.BrandColorPrimaryLight,
            BrandPaletteDefaults.NormalizeHex(model.ColorPrimaryLight, BrandPaletteDefaults.PrimaryLight), ct);
        await _settings.SetAsync(SystemSettingKeys.BrandColorAccent,
            BrandPaletteDefaults.NormalizeHex(model.ColorAccent, BrandPaletteDefaults.Accent), ct);
        await _settings.SetAsync(SystemSettingKeys.BrandColorSoft,
            BrandPaletteDefaults.NormalizeHex(model.ColorSoft, BrandPaletteDefaults.Soft), ct);
        await _settings.SetAsync(SystemSettingKeys.BrandColorSoft2,
            BrandPaletteDefaults.NormalizeHex(model.ColorSoft2, BrandPaletteDefaults.Soft2), ct);
        await _settings.SetAsync(SystemSettingKeys.BrandColorInk,
            BrandPaletteDefaults.NormalizeHex(model.ColorInk, BrandPaletteDefaults.Ink), ct);
        await _settings.SetAsync(SystemSettingKeys.BrandColorBorderSubtle,
            BrandPaletteDefaults.NormalizeHex(model.ColorBorderSubtle, BrandPaletteDefaults.BorderSubtle), ct);
        await _settings.SetAsync(SystemSettingKeys.BrandReferralQrVisible,
            model.ShowReferralQrWidget ? "true" : "false", ct);
    }
}
