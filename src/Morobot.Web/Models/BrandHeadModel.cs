using Morobot.Contracts.Licensing;

namespace Morobot.Web.Models;

public sealed class BrandHeadModel
{
    /// <summary>HttpContext.Items key holding the resolved branding for the current request.</summary>
    public const string ItemKey = "__morobot_brand_head";

    public const string DefaultAppName = "Morobot";
    public const string DefaultMarkPath = "/img/brand/morobot-mark.svg";
    public const string DefaultIconPngPath = "/img/brand/morobot-icon.png";
    public const string DefaultAppleTouchPath = "/img/brand/apple-touch-icon.png";

    public string AppName { get; init; } = DefaultAppName;
    public string BrandTitle { get; init; } = DefaultAppName;
    public string? OrganizationName { get; init; }
    public string MarkPath { get; init; } = DefaultMarkPath;
    public string FaviconPath { get; init; } = DefaultMarkPath;
    public string IconPngPath { get; init; } = DefaultIconPngPath;
    public string? LogoAbsoluteUrl { get; init; }
    public string? FaviconAbsoluteUrl { get; init; }
    public bool IsLicensedBranding { get; init; }

    public string ColorPrimary { get; init; } = BrandPaletteDefaults.Primary;
    public string ColorPrimaryDark { get; init; } = BrandPaletteDefaults.PrimaryDark;
    public string ColorPrimaryLight { get; init; } = BrandPaletteDefaults.PrimaryLight;
    public string ColorAccent { get; init; } = BrandPaletteDefaults.Accent;
    public string ColorSoft { get; init; } = BrandPaletteDefaults.Soft;
    public string ColorSoft2 { get; init; } = BrandPaletteDefaults.Soft2;
    public string ColorInk { get; init; } = BrandPaletteDefaults.Ink;
    public string ColorBorderSubtle { get; init; } = BrandPaletteDefaults.BorderSubtle;
    public string PrimaryRgb { get; init; } = BrandPaletteDefaults.ToRgbCsv(BrandPaletteDefaults.Primary);

    public bool ShowReferralQr { get; init; } = true;
    public string ReferralProductUrl { get; init; } = BrandPaletteDefaults.ReferralProductUrl;

    public string PageTitleSuffix => AppName;

    /// <summary>
    /// Full &lt;title&gt; text: "{page} — {brand}", or the site default when no page title is set.
    /// Avoids repeating the brand when the page title already contains it.
    /// </summary>
    public string ComposeTitle(string? pageTitle, string? siteDefault = null)
    {
        if (string.IsNullOrWhiteSpace(pageTitle))
            return string.IsNullOrWhiteSpace(siteDefault) ? AppName : $"{AppName} — {siteDefault}";

        var page = pageTitle.Trim();
        if (page.Contains(AppName, StringComparison.OrdinalIgnoreCase)) return page;
        return $"{page} — {AppName}";
    }

    public static BrandHeadModel FromDto(TenantBrandingDto dto, string? siteOrigin)
    {
        var palette = CopyPalette(dto);
        var app = string.IsNullOrWhiteSpace(dto.AppName) ? DefaultAppName : dto.AppName.Trim();
        var title = string.IsNullOrWhiteSpace(dto.BrandTitle) ? app : dto.BrandTitle.Trim();
        var showQr = !dto.IsLicensedBranding || dto.ShowReferralQrWidget;

        if (!dto.IsLicensedBranding)
        {
            return new BrandHeadModel
            {
                // Branding name/logo still apply without a licence; only the paid extras
                // (copyright-badge removal, referral QR toggle) are gated by IsLicensedBranding.
                AppName = app,
                BrandTitle = title,
                OrganizationName = dto.OrganizationName,
                MarkPath = ResolveWebPath(dto.LogoUrl, DefaultMarkPath),
                FaviconPath = ResolveWebPath(dto.FaviconUrl, string.IsNullOrWhiteSpace(dto.LogoUrl) ? DefaultMarkPath : ResolveWebPath(dto.LogoUrl, DefaultMarkPath)),
                IconPngPath = DefaultIconPngPath,
                IsLicensedBranding = false,
                ShowReferralQr = true,
                ColorPrimary = palette.primary,
                ColorPrimaryDark = palette.primaryDark,
                ColorPrimaryLight = palette.primaryLight,
                ColorAccent = palette.accent,
                ColorSoft = palette.soft,
                ColorSoft2 = palette.soft2,
                ColorInk = palette.ink,
                ColorBorderSubtle = palette.border,
                PrimaryRgb = BrandPaletteDefaults.ToRgbCsv(palette.primary)
            };
        }

        var logoPath = ResolveWebPath(dto.LogoUrl, DefaultMarkPath);
        var favPath = ResolveWebPath(dto.FaviconUrl, string.IsNullOrWhiteSpace(dto.LogoUrl) ? DefaultMarkPath : logoPath);

        return new BrandHeadModel
        {
            AppName = app,
            BrandTitle = title,
            OrganizationName = dto.OrganizationName,
            MarkPath = logoPath,
            FaviconPath = favPath,
            IconPngPath = favPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? favPath : DefaultIconPngPath,
            LogoAbsoluteUrl = ToAbsolute(siteOrigin, dto.LogoUrl),
            FaviconAbsoluteUrl = ToAbsolute(siteOrigin, dto.FaviconUrl ?? dto.LogoUrl),
            IsLicensedBranding = true,
            ShowReferralQr = showQr,
            ColorPrimary = palette.primary,
            ColorPrimaryDark = palette.primaryDark,
            ColorPrimaryLight = palette.primaryLight,
            ColorAccent = palette.accent,
            ColorSoft = palette.soft,
            ColorSoft2 = palette.soft2,
            ColorInk = palette.ink,
            ColorBorderSubtle = palette.border,
            PrimaryRgb = BrandPaletteDefaults.ToRgbCsv(palette.primary)
        };
    }

    private static (string primary, string primaryDark, string primaryLight, string accent, string soft, string soft2, string ink, string border) CopyPalette(TenantBrandingDto dto)
    {
        return (
            BrandPaletteDefaults.NormalizeHex(dto.ColorPrimary, BrandPaletteDefaults.Primary),
            BrandPaletteDefaults.NormalizeHex(dto.ColorPrimaryDark, BrandPaletteDefaults.PrimaryDark),
            BrandPaletteDefaults.NormalizeHex(dto.ColorPrimaryLight, BrandPaletteDefaults.PrimaryLight),
            BrandPaletteDefaults.NormalizeHex(dto.ColorAccent, BrandPaletteDefaults.Accent),
            BrandPaletteDefaults.NormalizeHex(dto.ColorSoft, BrandPaletteDefaults.Soft),
            BrandPaletteDefaults.NormalizeHex(dto.ColorSoft2, BrandPaletteDefaults.Soft2),
            BrandPaletteDefaults.NormalizeHex(dto.ColorInk, BrandPaletteDefaults.Ink),
            BrandPaletteDefaults.NormalizeHex(dto.ColorBorderSubtle, BrandPaletteDefaults.BorderSubtle));
    }

    public object ToExtensionJson(string? siteOrigin)
    {
        var origin = string.IsNullOrWhiteSpace(siteOrigin) ? null : siteOrigin.TrimEnd('/');
        var app = AppName;
        var extName = $"{app} Global";
        var actionTitle = $"{app} — {BrandTitle}";
        return new
        {
            appName = app,
            brandTitle = BrandTitle,
            organizationName = OrganizationName,
            logoUrl = LogoAbsoluteUrl ?? ToAbsolute(origin, MarkPath),
            faviconUrl = FaviconAbsoluteUrl ?? ToAbsolute(origin, FaviconPath),
            extensionName = extName,
            actionTitle,
            isLicensedBranding = IsLicensedBranding,
            colors = new
            {
                primary = ColorPrimary,
                primaryDark = ColorPrimaryDark,
                accent = ColorAccent,
                ink = ColorInk
            },
            updatedUtc = DateTime.UtcNow.ToString("O")
        };
    }

    private static string ResolveWebPath(string? stored, string fallback)
    {
        if (string.IsNullOrWhiteSpace(stored)) return fallback;
        var p = stored.Trim();
        if (p.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || p.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return p;
        return p.StartsWith('/') ? p : "/" + p;
    }

    private static string? ToAbsolute(string? origin, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var p = path.Trim();
        if (p.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || p.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return p;
        if (string.IsNullOrWhiteSpace(origin)) return p.StartsWith('/') ? p : "/" + p;
        return origin.TrimEnd('/') + (p.StartsWith('/') ? p : "/" + p);
    }
}
