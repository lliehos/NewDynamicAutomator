namespace Morobot.Licensing;

/// <summary>
/// Validation for the vendor-supplied referral widget link that ships inside the licence
/// file.
/// </summary>
/// <remarks>
/// The link is signed into the licence rather than read from the database so that it cannot
/// be repointed by whoever administers a deployment — the widget sends end users to a page
/// the vendor controls, and a database-only setting would let a buyer redirect that traffic.
/// Because the value ends up in an href and in a QR code, it is restricted to http/https
/// with a real host: a javascript: or data: value would otherwise be pasted straight into
/// the page. A value that fails validation is ignored, not treated as an error, so a typo in
/// the licence generator cannot take the whole deployment offline.
/// </remarks>
public static class LicenseReferralUrl
{
    /// <summary>Longest accepted URL. Long enough for any real product page, short enough to avoid abuse.</summary>
    public const int MaxLength = 500;

    /// <summary>
    /// Try to accept <paramref name="raw"/> as a widget link.
    /// Returns the trimmed absolute URL, or <c>null</c> when it is absent or unusable.
    /// </summary>
    public static string? TryNormalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var value = raw.Trim();
        if (value.Length > MaxLength) return null;

        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
        if (string.IsNullOrWhiteSpace(uri.Host)) return null;

        return uri.ToString();
    }

    /// <summary>Whether <paramref name="raw"/> is absent or an acceptable link.</summary>
    public static bool IsAcceptable(string? raw)
        => string.IsNullOrWhiteSpace(raw) || TryNormalize(raw) is not null;
}
