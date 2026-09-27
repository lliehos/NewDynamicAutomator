using Microsoft.AspNetCore.Http;
using Morobot.Infrastructure.Services;
using Morobot.Web.Models;

namespace Morobot.Web.Services;

public sealed class TenantBrandingViewService
{
    private readonly BrandingService _branding;
    private readonly BrandingCookieService _cookie;
    private readonly IHttpContextAccessor _http;
    private readonly IConfiguration _config;
    private readonly ILocaleService _locale;

    public TenantBrandingViewService(
        BrandingService branding,
        BrandingCookieService cookie,
        IHttpContextAccessor http,
        IConfiguration config,
        ILocaleService locale)
    {
        _branding = branding;
        _cookie = cookie;
        _http = http;
        _config = config;
        _locale = locale;
    }

    /// <summary>
    /// The branding for this request, served from the browser's cache when it is still current and
    /// read from the database otherwise.
    /// </summary>
    /// <remarks>
    /// The full read is roughly forty settings lookups, and it used to run on every page render just
    /// to draw the header. The cookie holds only what the header and the palette need; when it is
    /// present and its stamp matches the stored version, that read is skipped entirely.
    ///
    /// The stamp is compared against a value kept in the settings table, so a change saved from
    /// Admin → Branding — on any server, by any administrator — invalidates every cached copy on its
    /// next request rather than waiting for a cookie to expire.
    /// </remarks>
    public async Task<BrandHeadModel> GetHeadAsync(CancellationToken ct = default)
    {
        var isFa = ResolveIsFa();
        var culture = isFa ? "fa" : "en";

        var stamp = await _branding.GetStampAsync(ct);
        var cached = _cookie.Read(culture);
        if (cached is not null && !string.IsNullOrEmpty(stamp)
            && string.Equals(cached.Version, stamp, StringComparison.Ordinal))
            return BrandHeadModel.FromDto(cached.Data!.ToDto(), ResolveSiteOrigin(), isFa);

        var dto = await _branding.GetAsync(ct);
        // Re-written on every miss so a client that has no cookie, a stale one, or one for the other
        // language leaves this request with a usable copy — the next page render is then a hit.
        _cookie.Write(culture, Morobot.Contracts.Licensing.BrandStamp.Compute(dto), dto);

        // A deployment that has never saved branding has no stamp row, so the comparison above can
        // never match and every request would miss forever. Recording the stamp now makes the NEXT
        // request a hit, which is what turns this from a permanent cost into a one-off one.
        if (string.IsNullOrEmpty(stamp))
            await _branding.EnsureStampAsync(dto, ct);

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
