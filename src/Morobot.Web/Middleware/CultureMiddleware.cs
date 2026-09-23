using Morobot.Web.Services;

namespace Morobot.Web.Middleware;

public sealed class CultureMiddleware
{
    private readonly RequestDelegate _next;

    public CultureMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var culture = LocaleService.DefaultCulture;
        if (context.Request.Cookies.TryGetValue(LocaleService.CookieName, out var cookie)
            && LocaleService.IsSupported(cookie))
        {
            culture = LocaleService.Normalize(cookie);
        }

        context.Items["da_culture"] = culture;
        var cultureInfo = new System.Globalization.CultureInfo(culture == "en" ? "en-US" : "fa-IR");
        System.Globalization.CultureInfo.CurrentCulture = cultureInfo;
        System.Globalization.CultureInfo.CurrentUICulture = cultureInfo;

        await _next(context);
    }
}
