using System.Security.Cryptography;
using System.Text;

namespace Webautomator.Contracts.Licensing;

/// <summary>
/// A short, stable fingerprint of a tenant's branding, used to decide whether a browser's cached
/// copy is still current.
/// </summary>
/// <remarks>
/// <para>
/// Branding is read on every page render to draw the header and the palette, which is expensive, so
/// the browser caches it and the server only re-reads when something changed. Answering "did it
/// change?" needs a value that is cheap to compare and cheap to store — this hash.
/// </para>
/// <para>
/// It lives in Contracts rather than in either service because both ends of that decision need it:
/// <c>BrandingService</c> writes it when branding is saved, and the web layer compares it against
/// what the cookie carries. Two implementations would drift and produce a cache that never hits.
/// </para>
/// <para>
/// The input deliberately covers only the values the cached copy actually holds. Including the
/// diagram colours would invalidate every client's cookie when a colour changed, even though the
/// cookie does not carry colours — a cache miss that buys nothing.
/// </para>
/// </remarks>
public static class BrandStamp
{
    /// <summary>
    /// Hash the display-relevant branding values. The same values always produce the same stamp, so
    /// an unchanged save does not look like a change.
    /// </summary>
    public static string Compute(TenantBrandingDto dto)
    {
        // \u001f (unit separator) cannot appear in the values, so "a|b" and "a" + "|b" cannot collide.
        var material = string.Join('\u001f',
            dto.AppName, dto.BrandTitle, dto.OrganizationName,
            dto.AppNameFa, dto.AppNameEn,
            dto.OrganizationNameFa, dto.OrganizationNameEn,
            dto.LogoUrl, dto.FaviconUrl,
            dto.ColorPrimary, dto.ColorPrimaryDark, dto.ColorPrimaryLight, dto.ColorAccent,
            dto.ColorSoft, dto.ColorSoft2, dto.ColorInk, dto.ColorBorderSubtle,
            dto.IsLicensedBranding ? "1" : "0");

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        // Eight bytes is plenty: this decides a display cache hit, and a collision would merely show
        // a stale colour until the next save.
        return Convert.ToHexString(hash, 0, 8).ToLowerInvariant();
    }
}
