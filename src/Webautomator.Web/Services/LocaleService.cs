using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using Webautomator.Web.Models;

namespace Webautomator.Web.Services;

public interface ILocaleService
{
    string Culture { get; }
    string Dir { get; }
    bool IsRtl { get; }
    /// <summary>False when the licence excludes the second language; the language switch hides then.</summary>
    bool Bilingual { get; }
    string this[string key] { get; }
    string T(string key, params (string name, string? value)[] args);
}

public sealed class LocaleService : ILocaleService
{
    public const string CookieName = "da_culture";
    public const string DefaultCulture = "fa";

    /// <summary>
    /// HttpContext.Items key saying whether the licence includes the second language.
    /// </summary>
    /// <remarks>
    /// Set by <c>CultureMiddleware</c>, which has already resolved the licence for the request. Read
    /// from here rather than from the licence again so a page cannot end up half-bilingual: the
    /// switch, the culture and the rendered text all come from one decision.
    /// </remarks>
    public const string BilingualItemKey = "da.bilingual";

    /// <summary>
    /// Parsed locale files, keyed by culture, each remembering the file's write time.
    /// </summary>
    /// <remarks>
    /// Keying on the write time is what lets a drop-in replacement of <c>wwwroot/locales/*.json</c>
    /// take effect without restarting the process. A plain cache (and a bare "is this file
    /// present" check) made a locale hotfix invisible on a running install: the file on disk was
    /// new but every server-rendered label kept resolving from the dictionary parsed at startup,
    /// including the ones that had never existed before.
    /// </remarks>
    private static readonly ConcurrentDictionary<string, FlatLocale> FlatCache = new(StringComparer.OrdinalIgnoreCase);

    private sealed record FlatLocale(DateTime WrittenUtc, Dictionary<string, string> Flat);

    private readonly IHttpContextAccessor _http;
    private readonly IWebHostEnvironment _env;

    /// <summary>
    /// Keys whose whole value IS the product name. Resolved to the branding name outright,
    /// because the locale text is only a fallback for unbranded deployments.
    /// </summary>
    private static readonly HashSet<string> BrandNameKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "brand.name",
        "common.name",
        "common.appName",
        "common.dashBrand",
        "landing.title",
        "landing.ctaBandTitle",
        "landing.backSite",
        "landing.featuresImgAlt",
        "admin.brand",
        "editor.appName"
    };
    public LocaleService(IHttpContextAccessor http, IWebHostEnvironment env)
    {
        _http = http;
        _env = env;
    }

    /// <summary>Product name from Admin → Branding, or null when unused/unbranded.</summary>
    private string? BrandedAppName()
    {
        var ctx = _http.HttpContext;
        if (ctx is null) return null;
        // Branding is resolved once per request by TenantBrandingViewDataFilter and cached here.
        var branding = ctx.Items[BrandHeadModel.ItemKey] as BrandHeadModel;
        var name = branding?.AppName;
        return string.IsNullOrWhiteSpace(name) ? null : name;
    }

    /// <summary>
    /// The organization named by the licence (Admin → Branding → Organization), or null when the
    /// install is unlicensed or the licence carries no organization. Used by {org}, so the footer
    /// credits whoever actually licensed the product instead of the vendor that wrote it.
    /// </summary>
    private string? LicensedOrganizationName()
    {
        var ctx = _http.HttpContext;
        if (ctx is null) return null;
        var branding = ctx.Items[BrandHeadModel.ItemKey] as BrandHeadModel;
        var org = branding?.OrganizationName;
        return string.IsNullOrWhiteSpace(org) ? null : org;
    }

    public string Culture
    {
        get
        {
            var ctx = _http.HttpContext;
            if (ctx?.Items["da_culture"] is string fromItems && IsSupported(fromItems))
                return fromItems;
            if (ctx?.Request.Cookies.TryGetValue(CookieName, out var cookie) == true && IsSupported(cookie))
                return cookie!;
            return DefaultCulture;
        }
    }

    public bool IsRtl => !string.Equals(Culture, "en", StringComparison.OrdinalIgnoreCase);
    public string Dir => IsRtl ? "rtl" : "ltr";

    /// <summary>
    /// Whether to offer the language switch. Defaults to true so a request that somehow did not go
    /// through the middleware (a background task rendering a template, a unit test) behaves as a
    /// normal install rather than silently pretending its licence forbids the second language.
    /// </summary>
    public bool Bilingual =>
        _http.HttpContext?.Items[BilingualItemKey] is not bool bilingual || bilingual;

    public string this[string key] => T(key);

    public string T(string key, params (string name, string? value)[] args)
    {
        var flat = GetFlat(Culture);
        if (!flat.TryGetValue(key, out var text) || string.IsNullOrEmpty(text))
            GetFlat(DefaultCulture).TryGetValue(key, out text);
        text ??= key;
        if (args is { Length: > 0 })
        {
            foreach (var (name, value) in args)
                text = text.Replace("{" + name + "}", value ?? "", StringComparison.Ordinal);
        }
        if (text.Contains("{year}", StringComparison.Ordinal))
            text = text.Replace("{year}", DateTime.Now.Year.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);

        // Brand-aware resolution: never surface the stock name from the locale file.
        //  - {brand} inside any value is always expanded, so sentences compose correctly.
        //  - BrandNameKeys hold only the product name, so they are replaced outright.
        var brand = BrandedAppName();
        if (!string.IsNullOrEmpty(brand))
        {
            if (BrandNameKeys.Contains(key)) text = brand;
            else if (text.Contains("{brand}", StringComparison.Ordinal))
                text = text.Replace("{brand}", brand, StringComparison.Ordinal);
        }

        // {org} is the licensee, not the product. It is only known once a licence is applied, so an
        // unlicensed install must not print an empty gap after the dash — collapse the whole
        // separator along with the token and leave just the product name.
        if (text.Contains("{org}", StringComparison.Ordinal))
        {
            var org = LicensedOrganizationName();
            if (string.IsNullOrEmpty(org))
                text = text.Replace(" — {org}", "", StringComparison.Ordinal)
                           .Replace(" - {org}", "", StringComparison.Ordinal)
                           .Replace("{org}", "", StringComparison.Ordinal)
                           .Trim();
            else
                text = text.Replace("{org}", org, StringComparison.Ordinal);
        }

        return text;
    }

    public static bool IsSupported(string? culture) =>
        string.Equals(culture, "fa", StringComparison.OrdinalIgnoreCase)
        || string.Equals(culture, "en", StringComparison.OrdinalIgnoreCase);

    public static string Normalize(string? culture) =>
        IsSupported(culture) ? culture!.ToLowerInvariant() : DefaultCulture;

    public static void SetCookie(HttpResponse response, string culture)
    {
        culture = Normalize(culture);
        response.Cookies.Append(CookieName, culture, new CookieOptions
        {
            HttpOnly = false,
            Secure = false,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddYears(1),
            IsEssential = true
        });
    }

    private Dictionary<string, string> GetFlat(string culture)
    {
        culture = Normalize(culture);
        var path = Path.Combine(_env.WebRootPath, "locales", $"{culture}.json");

        DateTime written;
        try
        {
            written = File.Exists(path) ? File.GetLastWriteTimeUtc(path) : DateTime.MinValue;
        }
        catch (IOException)
        {
            // A path the file system will not answer for is treated as "no file": the page then
            // falls back to the keys, which is visible and diagnosable, rather than throwing.
            written = DateTime.MinValue;
        }

        if (FlatCache.TryGetValue(culture, out var cached) && cached.WrittenUtc == written)
            return cached.Flat;

        var flat = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (written != DateTime.MinValue)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            Flatten(doc.RootElement, "", flat);
        }
        FlatCache[culture] = new FlatLocale(written, flat);
        return flat;
    }

    private static void Flatten(JsonElement el, string prefix, Dictionary<string, string> flat)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in el.EnumerateObject())
                {
                    var next = string.IsNullOrEmpty(prefix) ? prop.Name : $"{prefix}.{prop.Name}";
                    Flatten(prop.Value, next, flat);
                }
                break;
            case JsonValueKind.String:
                flat[prefix] = el.GetString() ?? "";
                break;
            case JsonValueKind.Number:
            case JsonValueKind.True:
            case JsonValueKind.False:
                flat[prefix] = el.ToString();
                break;
        }
    }
}
