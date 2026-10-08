namespace Webautomator.Player.Services;

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
/// instead. There is NO same-machine guess in a shipped build — see <see cref="Resolve"/>.
/// </remarks>
public static class ServerAddress
{
    private static string? _baseUrl;

    /// <summary>The resolved base URL, or null when the licence carried none.</summary>
    public static string? BaseUrl => _baseUrl;

    /// <summary>Whether a real address was found (as opposed to no address at all).</summary>
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

        // Nothing usable in the licence. Do NOT guess http://localhost:5000 here: that did not
        // "keep the app usable", it made a correctly-installed client silently dial the end user's
        // own machine, where nothing is listening — so the symptom was an unreachable server with a
        // plausible-looking address in the box, which reads as a server outage rather than a missing
        // licence. Leaving it null lets the window say "no server address in this licence" and the
        // user can act on it. A developer running the pair locally can set Webautomator__DevServerUrl in
        // the environment instead of relying on a shipped default.
        _baseUrl = Environment.GetEnvironmentVariable("WEBAUTOMATOR_PLAYER_SERVER_URL")?.Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(_baseUrl)) _baseUrl = null;
        IsFromLicense = false;
    }
}
