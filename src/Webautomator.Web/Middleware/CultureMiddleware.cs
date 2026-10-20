using Webautomator.Domain;
using Webautomator.Infrastructure.Services;
using Webautomator.Licensing;
using Webautomator.Web.Services;

namespace Webautomator.Web.Middleware;

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
        var dbSetup = context.RequestServices.GetRequiredService<DatabaseSetupState>();

        // This middleware runs before MVC, so it is reached even on a request that will end at the
        // setup or progress page. Both reads below go to the database, and during first-run
        // initialisation the database may exist while its TABLES do not yet — so the check is
        // "is the application ready", not "is the database reachable". Reading either way would
        // throw a "Invalid object name 'SystemSettings'" on every request during startup and log a
        // failure storm for what is normal, expected work in progress.
        if (!dbSetup.IsReady)
        {
            ApplyCulture(context, LocaleService.DefaultCulture, bilingual: true);
            await _next(context);
            return;
        }

        string configured;
        try
        {
            configured = await settings.GetAsync(
                SystemSettingKeys.DefaultLanguage, LocaleService.DefaultCulture, context.RequestAborted);
        }
        catch
        {
            // The row is unreadable mid-request (a dropped connection, a permissions change). A
            // missing language preference must not take the page down; the shipped default is fine.
            configured = LocaleService.DefaultCulture;
        }

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

    /// <summary>
    /// Sets the request culture without consulting the database. Used on the setup path, where the
    /// configured language cannot be read — every other consumer of the culture reads the same two
    /// items this sets, so a fixed value here behaves like a normal request.
    /// </summary>
    private static void ApplyCulture(HttpContext context, string culture, bool bilingual)
    {
        context.Items[LocaleService.BilingualItemKey] = bilingual;
        context.Items["da_culture"] = culture;

        var cultureInfo = new System.Globalization.CultureInfo(culture == "en" ? "en-US" : "fa-IR");
        System.Globalization.CultureInfo.CurrentCulture = cultureInfo;
        System.Globalization.CultureInfo.CurrentUICulture = cultureInfo;
    }
}
