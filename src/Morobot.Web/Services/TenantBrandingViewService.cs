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
        // The brand name is shown on every page, so it has to follow the reader's language.
        // `da_culture` is the same cookie the i18n layer writes, so both agree.
        var isFa = ResolveIsFa();
        return BrandHeadModel.FromDto(dto, ResolveSiteOrigin(), isFa);
    }

    /// <summary>True when the current request is being served in Persian.</summary>
    private bool ResolveIsFa()
    {
        var ctx = _http.HttpContext;
        if (ctx is null) return true;
        var culture = ctx.Request.Cookies["da_culture"]
                      ?? ctx.Request.Query["lang"].ToString();
        if (string.IsNullOrWhiteSpace(culture))
        {
            // Fall back to the request's own culture when the cookie is absent.
            culture = System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        }
        return !string.Equals(culture, "en", StringComparison.OrdinalIgnoreCase);
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
