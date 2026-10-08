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

    /// <summary>
    /// Where the resolved address came from, so the UI can say so honestly.
    /// </summary>
    /// <remarks>
    /// The footer shows "<c>the server address</c>" and it matters whether that address is the one the
    /// licence authorised or the one this copy was downloaded from. A user who moved a player between
    /// machines, or edited a licence, is owed the difference rather than a value that looks equally
    /// authoritative either way.
    /// </remarks>
    public enum Source
    {
        None,
        License,
        Download,
        Environment
    }

    /// <summary>The origin of the currently resolved address.</summary>
    public static Source Origin { get; private set; } = Source.None;

    /// <summary>The deployment fingerprint the download recorded, when any.</summary>
    public static string? Fingerprint { get; private set; }

    /// <summary>
    /// A stable key derived from the resolved address, for when no fingerprint was recorded.
    /// </summary>
    /// <remarks>
    /// Used only to name this player's storage folder, so two servers on one machine do not share
    /// state. It is a plain SHA-256 of the base URL — not a security boundary, just a name — so a
    /// binding file that omits the fingerprint still yields a folder that is stable across launches
    /// and different from another server's.
    /// </remarks>
    public static string? FingerprintFromBaseUrl
    {
        get
        {
            if (string.IsNullOrWhiteSpace(_baseUrl)) return null;
            var bytes = System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(_baseUrl));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }
    }

    public static void Reset()
    {
        _baseUrl = null;
        IsFromLicense = false;
        Origin = Source.None;
        Fingerprint = null;
    }

    /// <summary>
    /// Resolve from a licence document, falling back to the binding file the download carried.
    /// </summary>
    /// <param name="serverBaseUrl">The signed URL, when the licence has one.</param>
    /// <param name="allowedHost">The host lock, used when no URL was signed.</param>
    /// <param name="binding">The download binding, used only when the licence names no server.</param>
    public static void Resolve(string? serverBaseUrl, string? allowedHost, PlayerBinding? binding = null)
    {
        Fingerprint = binding?.Fingerprint;

        if (!string.IsNullOrWhiteSpace(serverBaseUrl))
        {
            _baseUrl = serverBaseUrl.Trim().TrimEnd('/');
            IsFromLicense = true;
            Origin = Source.License;
            return;
        }
        if (!string.IsNullOrWhiteSpace(allowedHost))
        {
            var host = allowedHost.Trim().TrimEnd('/');
            // The host lock may or may not carry a scheme; a bare host is reachable over https, and
            // guessing http for a real deployment would silently downgrade every call.
            _baseUrl = host.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? host : $"https://{host}";
            IsFromLicense = true;
            Origin = Source.License;
            return;
        }

        // No address in the licence. The binding the panel stamped into the download comes next: it
        // is what makes a player downloaded from a server reach THAT server on first launch, which is
        // the whole point — the address should not have to be typed back in by the person who just
        // downloaded the thing. It is used only because the licence named nothing; a signed document
        // always outranks a plain file beside the executable.
        if (binding is { IsPresent: true })
        {
            _baseUrl = binding.ServerBaseUrl;
            IsFromLicense = false;
            Origin = Source.Download;
            return;
        }

        // Nothing usable in the licence or the binding. Do NOT guess http://localhost:5000 here: that
        // did not "keep the app usable", it made a correctly-installed client silently dial the end
        // user's own machine, where nothing is listening — so the symptom was an unreachable server
        // with a plausible-looking address in the box, which reads as a server outage rather than a
        // missing licence. Leaving it null lets the window say "no server address in this licence" and
        // the user can act on it. A developer running the pair locally can set
        // WEBAUTOMATOR_PLAYER_SERVER_URL in the environment instead of relying on a shipped default.
        _baseUrl = Environment.GetEnvironmentVariable("WEBAUTOMATOR_PLAYER_SERVER_URL")?.Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(_baseUrl))
        {
            _baseUrl = null;
            Origin = Source.None;
        }
        else
        {
            Origin = Source.Environment;
        }
        IsFromLicense = false;
    }
}
