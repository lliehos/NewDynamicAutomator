using Microsoft.AspNetCore.Http;
using Morobot.Infrastructure.Services;
using Morobot.Web.Models;

namespace Morobot.Web.Services;

public sealed class TenantBrandingViewService
{
    private readonly BrandingService _branding;
    private readonly IHttpContextAccessor _http;
    private readonly IConfiguration _config;

    public TenantBrandingViewService(BrandingService branding, IHttpContextAccessor http, IConfiguration config)
    {
        _branding = branding;
        _http = http;
        _config = config;
    }

    public async Task<BrandHeadModel> GetHeadAsync(CancellationToken ct = default)
    {
        var dto = await _branding.GetAsync(ct);
        return BrandHeadModel.FromDto(dto, ResolveSiteOrigin());
    }

    public string? ResolveSiteOrigin()
    {
        var req = _http.HttpContext?.Request;
        if (req != null && !string.IsNullOrEmpty(req.Host.Host))
            return $"{req.Scheme}://{req.Host.Value}";

        var configured = _config["Morobot:PublicBaseUrl"]
                         ?? _config["Api:BaseUrl"];
        return string.IsNullOrWhiteSpace(configured) ? null : configured.TrimEnd('/');
    }
}
