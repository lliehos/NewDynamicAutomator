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
            return new TenantBrandingDto
            {
                AppName = DefaultAppName,
                BrandTitle = DefaultAppName,
                IsLicensedBranding = false
            };
        }

        var appName = await _settings.GetAsync(SystemSettingKeys.BrandAppName, DefaultAppName, ct);
        var title = await _settings.GetAsync(SystemSettingKeys.BrandTitle, appName, ct);
        var org = await _settings.GetAsync(SystemSettingKeys.BrandOrganization, "", ct);
        var logo = await _settings.GetAsync(SystemSettingKeys.BrandLogoPath, "", ct);
        var favicon = await _settings.GetAsync(SystemSettingKeys.BrandFaviconPath, "", ct);

        return new TenantBrandingDto
        {
            AppName = string.IsNullOrWhiteSpace(appName) ? DefaultAppName : appName,
            BrandTitle = string.IsNullOrWhiteSpace(title) ? appName : title,
            OrganizationName = string.IsNullOrWhiteSpace(org) ? state.Payload?.OrganizationName : org,
            LogoUrl = string.IsNullOrWhiteSpace(logo) ? null : logo,
            FaviconUrl = string.IsNullOrWhiteSpace(favicon) ? null : favicon,
            IsLicensedBranding = true
        };
    }

    public async Task SaveAsync(TenantBrandingDto model, CancellationToken ct = default)
    {
        var state = await _license.GetRuntimeStateAsync(ct);
        if (!state.AllowsBranding)
            throw new InvalidOperationException("branding.error.notLicensed");

        await _settings.SetAsync(SystemSettingKeys.BrandAppName, model.AppName, ct);
        await _settings.SetAsync(SystemSettingKeys.BrandTitle, model.BrandTitle, ct);
        await _settings.SetAsync(SystemSettingKeys.BrandOrganization, model.OrganizationName ?? "", ct);
        if (!string.IsNullOrWhiteSpace(model.LogoUrl))
            await _settings.SetAsync(SystemSettingKeys.BrandLogoPath, model.LogoUrl, ct);
        if (!string.IsNullOrWhiteSpace(model.FaviconUrl))
            await _settings.SetAsync(SystemSettingKeys.BrandFaviconPath, model.FaviconUrl, ct);
    }
}
