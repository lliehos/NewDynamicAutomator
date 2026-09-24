using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using Morobot.Web.Models;

namespace Morobot.Web.Services;

public interface ILocaleService
{
    string Culture { get; }
    string Dir { get; }
    bool IsRtl { get; }
    string this[string key] { get; }
    string T(string key, params (string name, string? value)[] args);
}

public sealed class LocaleService : ILocaleService
{
    public const string CookieName = "da_culture";
    public const string DefaultCulture = "fa";

    private static readonly ConcurrentDictionary<string, Dictionary<string, string>> FlatCache = new(StringComparer.OrdinalIgnoreCase);

    private readonly IHttpContextAccessor _http;
    private readonly IWebHostEnvironment _env;

    /// <summary>
    /// Locale keys that carry the product name. They are resolved against the tenant's
    /// Admin → Branding value instead of the hard-coded text in the locale files, so a
    /// rebranded deployment never shows the stock name. The locale entry is used as the
    /// fallback when branding is not configured.
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

    /// <summary>Keys whose value is a full sentence containing the brand; {brand} is substituted.</summary>
    private static readonly HashSet<string> BrandTokenKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "brand.copyright",
        "metadata.title",
        "metadata.description"
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

        // Brand-aware keys always reflect Admin → Branding rather than the stock locale text.
        var brand = BrandedAppName();
        if (!string.IsNullOrEmpty(brand))
        {
            if (BrandNameKeys.Contains(key))
                text = brand;
            else if (BrandTokenKeys.Contains(key))
                text = text.Replace("{brand}", brand, StringComparison.Ordinal);
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
        if (_env.IsDevelopment())
        {
            var path = Path.Combine(_env.WebRootPath, "locales", $"{culture}.json");
            var flat = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!File.Exists(path)) return flat;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            Flatten(doc.RootElement, "", flat);
            return flat;
        }
        return FlatCache.GetOrAdd(culture, c =>
        {
            var path = Path.Combine(_env.WebRootPath, "locales", $"{c}.json");
            var flat = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!File.Exists(path)) return flat;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            Flatten(doc.RootElement, "", flat);
            return flat;
        });
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
