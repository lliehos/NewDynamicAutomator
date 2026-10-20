using System.IO;
using System.Text.Json;

namespace Webautomator.Player.Services;

/// <summary>
/// The server this player was downloaded from, read from the binding file the panel stamps into the
/// download package.
/// </summary>
/// <remarks>
/// This is the player's half of the server binding, the same idea as the browser extension's
/// <c>webautomator-binding.json</c>: one machine can carry several players, each pointing at a
/// different server, and a player must prove which server it belongs to rather than guess. The
/// licence is still the authority when it carries an address — a signed document outranks a file
/// sitting next to the executable — so the binding is only consulted when the licence names no
/// server. That ordering is deliberate: it keeps a properly licensed install correct even if its
/// binding file is edited, while a fresh download with no licence yet still reaches the server it
/// came from instead of asking the user to type an address.
///
/// The binding lives beside the executable (where the zip extracted it), so it is read once per
/// launch and never written by the player itself.
/// </remarks>
public sealed class PlayerBinding
{
    /// <summary>The file name the panel writes into the download package.</summary>
    public const string FileName = "player-binding.json";

    /// <summary>The server base URL recorded at download time, normalised, or null.</summary>
    public string? ServerBaseUrl { get; private init; }

    /// <summary>The deployment fingerprint recorded at download time, or null.</summary>
    public string? Fingerprint { get; private init; }

    /// <summary>True when a binding file with a usable address was found and parsed.</summary>
    public bool IsPresent => !string.IsNullOrWhiteSpace(ServerBaseUrl);

    private PlayerBinding() { }

    /// <summary>
    /// Read the binding file from beside the executable.
    /// </summary>
    /// <remarks>
    /// Best-effort by design: a missing, unreadable or malformed file is the same as no binding, and
    /// the caller falls through to the development fallback rather than failing to start. A file
    /// that cannot be trusted must never be able to redirect the app, so only the fields the player
    /// actually needs are read and the address is validated before use.
    /// </remarks>
    public static PlayerBinding Load()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, FileName);
            if (!File.Exists(path)) return new PlayerBinding();

            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var serverBase = root.TryGetProperty("serverBase", out var s) ? s.GetString() : null;
            var fingerprint = root.TryGetProperty("fingerprint", out var f) ? f.GetString() : null;

            serverBase = Normalize(serverBase);
            return new PlayerBinding
            {
                ServerBaseUrl = serverBase,
                Fingerprint = string.IsNullOrWhiteSpace(fingerprint) ? null : fingerprint.Trim()
            };
        }
        catch
        {
            return new PlayerBinding();
        }
    }

    /// <summary>
    /// Turn a recorded address into a usable base URL, or null when it is not one.
    /// </summary>
    /// <remarks>
    /// Only absolute http/https URLs survive. A binding file is a plain file a user could edit, so it
    /// is treated as untrusted input: anything that is not a well-formed web URL is discarded rather
    /// than concatenated into a request path.
    /// </remarks>
    private static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim().TrimEnd('/');
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
        return trimmed;
    }
}
