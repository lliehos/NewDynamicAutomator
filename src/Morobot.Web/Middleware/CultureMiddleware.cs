using Morobot.Domain;
using Morobot.Infrastructure.Services;
using Morobot.Licensing;
using Morobot.Web.Services;

namespace Morobot.Web.Middleware;

/// <summary>
/// Decides which language a request is served in, and publishes it for the rest of the pipeline.
/// </summary>
/// <remarks>
/// <para>
/// The order is: an explicit choice by this visitor, then the deployment's configured default, then
/// the built-in one. The cookie records a deliberate act — the visitor pressed the language switch —
/// so it outranks the admin's setting; the setting exists for visitors who have not chosen, which is
/// what a first-time reader, a bookmark and a search engine all look like.
/// </para>
/// <para>
/// When the licence does not include the second language the visitor's choice is ignored and the
/// default is used regardless. Ignored rather than rejected: a cookie written before the licence
/// changed must not put a visitor into a language the install no longer offers.
/// </para>
/// </remarks>
public sealed class CultureMiddleware
{
    private readonly RequestDelegate _next;

    public CultureMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var settings = context.RequestServices.GetRequiredService<SystemSettingsService>();
        var license = context.RequestServices.GetRequiredService<LicenseService>();

        var configured = await settings.GetAsync(
            SystemSettingKeys.DefaultLanguage, LocaleService.DefaultCulture, context.RequestAborted);
        var fallback = LocaleService.Normalize(configured);

        LicenseRuntimeState runtime;
        try
        {
            runtime = await license.GetRuntimeStateAsync(context.RequestAborted);
        }
        catch
        {
            // A licence layer that cannot be read is not a reason to take a language away from a
            // visitor; the licence has its own restricted mode for that. Keep the shipped behaviour.
            runtime = LicenseRuntimeState.Cloud();
        }

        var bilingual = runtime.AllowsBilingual;

        var culture = fallback;
        if (bilingual
            && context.Request.Cookies.TryGetValue(LocaleService.CookieName, out var cookie)
            && LocaleService.IsSupported(cookie))
        {
            culture = LocaleService.Normalize(cookie);
        }

        // Published so a layout can ask whether to draw the language switch at all, instead of every
        // view re-deriving it from the licence.
        context.Items[LocaleService.BilingualItemKey] = bilingual;
        context.Items["da_culture"] = culture;

        var cultureInfo = new System.Globalization.CultureInfo(culture == "en" ? "en-US" : "fa-IR");
        System.Globalization.CultureInfo.CurrentCulture = cultureInfo;
        System.Globalization.CultureInfo.CurrentUICulture = cultureInfo;

        await _next(context);
    }
}
