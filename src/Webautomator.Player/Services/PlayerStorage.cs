using System.IO;

namespace Webautomator.Player.Services;

/// <summary>
/// Where this player keeps its per-server state on disk.
/// </summary>
/// <remarks>
/// One machine can carry several players, each bound to a different server — the same situation the
/// browser extension already lives with. If they all shared one folder, the licence cached by the
/// last sign-in, the token reset, and the device fingerprint of one server would overwrite the
/// other's: signing into server A would leave server B's player pointing at the wrong licence, and a
/// token minted by A could be replayed against B. The fix is the same as the extension's: stop
/// treating the server as global and give each server its own folder.
///
/// The folder is keyed by the deployment fingerprint when the binding carries one (stable and unique
/// per server), and falls back to a hash of the base URL when it does not (an older package, or a
/// licence that named the server without a download). "default" is the unbound state before either
/// is known, and matches the extension's own naming so the two clients read the same way.
///
/// The root is <c>%LOCALAPPDATA%\WebautomatorDesktop</c>, so an install that predates this change is
/// migrated rather than abandoned — see <see cref="MigrateLegacyFiles"/>.
/// </remarks>
public static class PlayerStorage
{
    private const string RootFolder = "WebautomatorDesktop";

    /// <summary>The key this player's state is filed under. Never empty.</summary>
    public static string ServerKey
    {
        get
        {
            var fp = ServerAddress.Fingerprint ?? ServerAddress.FingerprintFromBaseUrl;
            return string.IsNullOrWhiteSpace(fp) ? "default" : Shorten(fp!);
        }
    }

    /// <summary>The folder this player's state lives in; created on demand.</summary>
    public static string DataDirectory
    {
        get
        {
            var dir = Path.Combine(Root, ServerKey);
            try { Directory.CreateDirectory(dir); } catch { /* the caller's write will report the real failure */ }
            return dir;
        }
    }

    /// <summary>A file inside this player's own folder.</summary>
    public static string FilePath(string fileName) => Path.Combine(DataDirectory, fileName);

    private static string Root => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        RootFolder);

    /// <summary>
    /// Keep the folder name readable and filesystem-safe: a fingerprint is already hex, but a URL
    /// hash or a hand-written key may not be, and a key is not allowed to contain path separators.
    /// </summary>
    private static string Shorten(string key)
    {
        Span<char> buffer = stackalloc char[Math.Min(key.Length, 24)];
        var n = 0;
        foreach (var ch in key)
        {
            if (n >= buffer.Length) break;
            if (char.IsLetterOrDigit(ch)) buffer[n++] = ch;
            else if (ch is '-' or '_') buffer[n++] = ch;
        }
        return n == 0 ? "default" : new string(buffer[..n]);
    }

    /// <summary>
    /// Move the pre-isolation files into this server's folder, once.
    /// </summary>
    /// <remarks>
    /// Before per-server folders existed everything sat directly under the root. An install that
    /// upgrades should keep its cached licence and remembered user rather than appear to log out, so
    /// the first launch that knows its key adopts the old files. It is a copy, not a move: a second
    /// player bound to a different server may still be relying on the same legacy files until it
    /// establishes its own key.
    /// </remarks>
    public static void MigrateLegacyFiles()
    {
        try
        {
            if (ServerKey == "default") return;
            var dir = DataDirectory;
            foreach (var name in new[] { "license.json", "settings.json" })
            {
                var legacy = Path.Combine(Root, name);
                var target = Path.Combine(dir, name);
                if (File.Exists(legacy) && !File.Exists(target))
                    File.Copy(legacy, target);
            }
        }
        catch
        {
            // Migration is a convenience; a failure just means the user signs in again.
        }
    }
}
