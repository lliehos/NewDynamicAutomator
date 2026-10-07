namespace Morobot.Player.Services;

/// <summary>
/// The player's own name, taken from the deployment's branding.
/// </summary>
/// <remarks>
/// The window title, the about text and the update prompt all read "<AppName> Player", where
/// AppName is the ENGLISH name the admin set for the panel (Admin → Branding). Using the English
/// name rather than the Persian one is deliberate: this is the product's identity, and the
/// extension follows the same rule, so the two clients of one server name themselves consistently.
///
/// The value is resolved once after sign-in and held here rather than passed around, because it is
/// needed by windows that are created long after login (a run window, an update prompt) and
/// threading it through every constructor would make the name a parameter of everything.
/// </remarks>
public static class PlayerIdentity
{
    private const string FallbackAppName = "Morobot";

    private static string _appName = FallbackAppName;

    /// <summary>The deployment's app name, e.g. "Morobot" or a customer's own name.</summary>
    public static string AppName => _appName;

    /// <summary>What the app calls itself: "&lt;AppName&gt; Player".</summary>
    public static string ProductName => $"{_appName} Player";

    /// <summary>Set from the branding the panel serves; blank falls back to the shipped name.</summary>
    public static void SetAppName(string? appName)
    {
        _appName = string.IsNullOrWhiteSpace(appName) ? FallbackAppName : appName.Trim();
    }

    public static void Reset() => _appName = FallbackAppName;
}
