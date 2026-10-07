namespace Morobot.Player.Services;

/// <summary>
/// The server address this player must talk to.
/// </summary>
/// <remarks>
/// Resolved from the licence that authorises the install, never typed by the user. That is not just
/// convenience: the address is fixed by the licence, and letting it be typed could only ever point
/// the app at a different deployment than the one it is licensed for — a misconfiguration that would
/// look like a login failure. Asking for it also made the user responsible for knowing something the
/// product already knows.
///
/// The fallback order is deliberate: the signed URL first, then the host lock a licence may carry
/// instead, and only then a same-machine development address, so a developer can still run the pair
/// locally without signing a licence.
/// </remarks>
public static class ServerAddress
{
    private static string? _baseUrl;

    /// <summary>The resolved base URL, or null when the licence carried none.</summary>
    public static string? BaseUrl => _baseUrl;

    /// <summary>Whether a real address was found (as opposed to the development fallback).</summary>
    public static bool IsFromLicense { get; private set; }

    public static void Reset()
    {
        _baseUrl = null;
        IsFromLicense = false;
    }

    /// <summary>
    /// Resolve from a licence document.
    /// </summary>
    /// <param name="serverBaseUrl">The signed URL, when the licence has one.</param>
    /// <param name="allowedHost">The host lock, used when no URL was signed.</param>
    public static void Resolve(string? serverBaseUrl, string? allowedHost)
    {
        if (!string.IsNullOrWhiteSpace(serverBaseUrl))
        {
            _baseUrl = serverBaseUrl.Trim().TrimEnd('/');
            IsFromLicense = true;
            return;
        }
        if (!string.IsNullOrWhiteSpace(allowedHost))
        {
            var host = allowedHost.Trim().TrimEnd('/');
            // The host lock may or may not carry a scheme; a bare host is reachable over https, and
            // guessing http for a real deployment would silently downgrade every call.
            _baseUrl = host.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? host : $"https://{host}";
            IsFromLicense = true;
            return;
        }

        // No licence information at all: fall back to the local pair, which is what running the
        // server and the player on one development machine looks like.
        _baseUrl = "http://localhost:5000";
        IsFromLicense = false;
    }
}
