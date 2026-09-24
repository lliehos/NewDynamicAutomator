using Microsoft.AspNetCore.Mvc;
using Morobot.Contracts.Licensing;
using Morobot.Infrastructure.Services;
using Morobot.Web.Services;

namespace Morobot.Web.ViewComponents;

public sealed class SiteChromeViewComponent : ViewComponent
{
    private readonly LicenseService _license;
    private readonly BrandingService _branding;
    private readonly ILocaleService _locale;

    public SiteChromeViewComponent(LicenseService license, BrandingService branding, ILocaleService locale)
    {
        _license = license;
        _branding = branding;
        _locale = locale;
    }

    public async Task<IViewComponentResult> InvokeAsync()
    {
        var runtime = await _license.GetRuntimeStateAsync(HttpContext.RequestAborted);
        var branding = await _branding.GetAsync(HttpContext.RequestAborted);
        var model = new SiteChromeModel
        {
            Branding = branding,
            ShowCopyright = runtime.ShowCopyright,
            RuntimeMode = runtime.Mode.ToString(),
            CopyrightText = _locale["site.copyright.unlicensed"]
        };
        return View(model);
    }
}

public sealed class SiteChromeModel
{
    public TenantBrandingDto Branding { get; set; } = new();
    public bool ShowCopyright { get; set; }
    public string RuntimeMode { get; set; } = "";
    public string CopyrightText { get; set; } = "";
}
