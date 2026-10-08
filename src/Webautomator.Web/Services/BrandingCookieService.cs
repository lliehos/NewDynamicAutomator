using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Webautomator.Contracts.Licensing;
using Webautomator.Web.Models;

namespace Webautomator.Web.Services;

/// <summary>
/// Carries the tenant's branding to the browser once, so every page render does not have to read
/// ~40 settings rows just to draw the header, the logo and the palette.
/// </summary>
/// <remarks>
/// <para>
/// <b>This is a display cache and is never authoritative.</b> The cookie is deliberately NOT signed:
/// it exists to save a database round-trip for values that only affect how the site looks. Nothing
/// security-relevant may be read from it — whether the copyright badge is shown, whether the
/// referral widget appears and every licence gate keep coming from the signed licence and the JWT.
/// A user who edits this cookie changes their own theme and nothing else.
/// </para>
/// <para>
/// The <see cref="Envelope.Version"/> stamp is what makes the cache safe to trust for display: it is
/// a hash of the underlying settings, so the moment an administrator saves branding the stamp
/// changes and every client's cached copy is recognised as stale and re-read from the database.
/// Without it a palette change would not reach anyone who already had a cookie.
/// </para>
/// </remarks>
public sealed class BrandingCookieService
{
    public const string CookieName = "da_branding";

    /// <summary>
    /// One year, matching the language cookie. The value is re-stamped whenever branding changes, so
    /// a long life costs nothing but avoids a re-read on every visit.
    /// </summary>
    private static readonly TimeSpan Lifetime = TimeSpan.FromDays(365);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly IHttpContextAccessor _http;

    public BrandingCookieService(IHttpContextAccessor http) => _http = http;

    /// <summary>
    /// The branding cached in the request's cookie, or null when there is none, it cannot be parsed,
    /// or it was written for a different language than the one being rendered.
    /// </summary>
    /// <remarks>
    /// The language is part of the payload rather than applied at render time because the name,
    /// title and organisation differ per language: a copy cached while reading Persian would show
    /// Persian text to a reader who has since switched to English. Keying on it means the switch
    /// simply misses the cache and re-reads, which is the correct behaviour for a display cache.
    /// </remarks>
    public CachedBrandingEnvelope? Read(string culture)
    {
        var ctx = _http.HttpContext;
        if (ctx is null) return null;
        if (!ctx.Request.Cookies.TryGetValue(CookieName, out var raw) || string.IsNullOrWhiteSpace(raw))
            return null;

        try
        {
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(raw));
            var envelope = JsonSerializer.Deserialize<CachedBrandingEnvelope>(json, JsonOptions);
            if (envelope?.Data is null) return null;
            if (!string.Equals(envelope.Culture, culture, StringComparison.OrdinalIgnoreCase)) return null;
            return envelope;
        }
        catch (Exception ex) when (ex is FormatException or JsonException or ArgumentException)
        {
            // A malformed cookie is not an error worth surfacing: it is a stale or hand-edited value,
            // and the caller's fallback is simply to read the settings. Never let it break the page.
            return null;
        }
    }

    /// <summary>
    /// Write the current branding for <paramref name="culture"/>, stamped with
    /// <paramref name="version"/> so the next change invalidates it.
    /// </summary>
    public void Write(string culture, string version, TenantBrandingDto dto)
    {
        var ctx = _http.HttpContext;
        if (ctx is null) return;

        var envelope = new CachedBrandingEnvelope
        {
            Version = version,
            Culture = culture,
            Data = CachedBranding.FromDto(dto)
        };

        var json = JsonSerializer.Serialize(envelope, JsonOptions);
        var value = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));

        ctx.Response.Cookies.Append(CookieName, value, new CookieOptions
        {
            // Readable by the scripts that render the brand client-side (i18n.js, referral QR), which
            // is the whole point of caching it here. Safe because the value only styles the page.
            HttpOnly = false,
            Secure = ctx.Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.Add(Lifetime),
            IsEssential = true
        });
    }

    /// <summary>The display-only values the cookie carries.</summary>
    public sealed class CachedBranding
    {
        public string? AppName { get; set; }
        public string? BrandTitle { get; set; }
        public string? OrganizationName { get; set; }

        /// <summary>
        /// The per-language identity values.
        /// </summary>
        /// <remarks>
        /// These are what <see cref="BrandHeadModel"/> actually renders — the unqualified values above
        /// are only the legacy fallback. Caching the fallback without them made a cache hit show the
        /// legacy name (an old "Automator") while the uncached render showed the real per-language one,
        /// so the brand name visibly changed depending on whether the cookie happened to be current.
        /// Both languages are carried even though the envelope is keyed by one, so switching language
        /// does not have to re-read for a name that is already in hand.
        /// </remarks>
        public string? AppNameFa { get; set; }
        public string? AppNameEn { get; set; }
        public string? OrganizationNameFa { get; set; }
        public string? OrganizationNameEn { get; set; }

        public string? LogoUrl { get; set; }
        public string? FaviconUrl { get; set; }
        public bool IsLicensedBranding { get; set; }

        public string? ColorPrimary { get; set; }
        public string? ColorPrimaryDark { get; set; }
        public string? ColorPrimaryLight { get; set; }
        public string? ColorAccent { get; set; }
        public string? ColorSoft { get; set; }
        public string? ColorSoft2 { get; set; }
        public string? ColorInk { get; set; }
        public string? ColorBorderSubtle { get; set; }

        /// <summary>
        /// Rebuild the branding DTO this cache stands in for.
        /// </summary>
        /// <remarks>
        /// Only the display fields are populated. Everything the cache does not carry — the diagram
        /// colours, the diagram defaults, the referral-widget switch — is left at its default and must
        /// be read from the database by whoever needs it. That is what keeps this a cache for the
        /// header and palette rather than a second source of truth for the whole branding feature.
        /// </remarks>
        public TenantBrandingDto ToDto() => new()
        {
            AppName = AppName ?? BrandHeadModel.DefaultAppName,
            BrandTitle = BrandTitle ?? AppName ?? BrandHeadModel.DefaultAppName,
            OrganizationName = OrganizationName,
            AppNameFa = AppNameFa,
            AppNameEn = AppNameEn,
            OrganizationNameFa = OrganizationNameFa,
            OrganizationNameEn = OrganizationNameEn,
            LogoUrl = LogoUrl,
            FaviconUrl = FaviconUrl,
            IsLicensedBranding = IsLicensedBranding,
            ColorPrimary = ColorPrimary ?? BrandPaletteDefaults.Primary,
            ColorPrimaryDark = ColorPrimaryDark ?? BrandPaletteDefaults.PrimaryDark,
            ColorPrimaryLight = ColorPrimaryLight ?? BrandPaletteDefaults.PrimaryLight,
            ColorAccent = ColorAccent ?? BrandPaletteDefaults.Accent,
            ColorSoft = ColorSoft ?? BrandPaletteDefaults.Soft,
            ColorSoft2 = ColorSoft2 ?? BrandPaletteDefaults.Soft2,
            ColorInk = ColorInk ?? BrandPaletteDefaults.Ink,
            ColorBorderSubtle = ColorBorderSubtle ?? BrandPaletteDefaults.BorderSubtle
        };

        public static CachedBranding FromDto(TenantBrandingDto dto) => new()
        {
            AppName = dto.AppName,
            BrandTitle = dto.BrandTitle,
            OrganizationName = dto.OrganizationName,
            AppNameFa = dto.AppNameFa,
            AppNameEn = dto.AppNameEn,
            OrganizationNameFa = dto.OrganizationNameFa,
            OrganizationNameEn = dto.OrganizationNameEn,
            LogoUrl = dto.LogoUrl,
            FaviconUrl = dto.FaviconUrl,
            IsLicensedBranding = dto.IsLicensedBranding,
            ColorPrimary = dto.ColorPrimary,
            ColorPrimaryDark = dto.ColorPrimaryDark,
            ColorPrimaryLight = dto.ColorPrimaryLight,
            ColorAccent = dto.ColorAccent,
            ColorSoft = dto.ColorSoft,
            ColorSoft2 = dto.ColorSoft2,
            ColorInk = dto.ColorInk,
            ColorBorderSubtle = dto.ColorBorderSubtle
        };
    }

    /// <summary>
    /// What the cookie actually stores: the stamp, the language it was written for, and the values.
    /// </summary>
    /// <remarks>
    /// The stamp and language live in the envelope rather than inside <see cref="CachedBranding"/>
    /// because they describe the cache entry, not the tenant's branding.
    /// </remarks>
    public sealed class CachedBrandingEnvelope
    {
        public string? Version { get; set; }
        public string? Culture { get; set; }
        public CachedBranding? Data { get; set; }
    }
}
