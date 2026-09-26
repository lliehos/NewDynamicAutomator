using System.Reflection;

namespace Morobot.Web.Services;

/// <summary>
/// A single build stamp for static assets, so a cache-busting query string no longer has to be
/// hand-written and hand-bumped per file.
/// </summary>
/// <remarks>
/// The alternative — the `?v=some-slug-1` tokens scattered across the views — works, but only as
/// long as whoever edits a file remembers to bump its token. Forgetting is silent: the browser
/// keeps serving the old asset and the change looks like it never happened. Deriving the token
/// from the assembly's informational version removes the memory requirement entirely, and
/// includes the git SHA because the SDK appends `+&lt;sha&gt;` to that version.
///
/// The value only changes when the binary changes, which is exactly the condition under which a
/// cached asset could be stale.
/// </remarks>
public interface IAppVersionService
{
    /// <summary>Short, URL-safe build stamp — suitable for a <c>?v=</c> query string.</summary>
    string AssetVersion { get; }

    /// <summary>The full version string, for display (About/branding surfaces).</summary>
    string Version { get; }
}

/// <inheritdoc />
public sealed class AppVersionService : IAppVersionService
{
    public AppVersionService()
    {
        // InformationalVersion is preferred because the SDK stamps it as "<version>+<gitsha>";
        // the informational text is what actually distinguishes two builds of the same version.
        var assembly = Assembly.GetEntryAssembly() ?? typeof(AppVersionService).Assembly;
        var informational = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;

        Version = string.IsNullOrWhiteSpace(informational)
            ? assembly.GetName().Version?.ToString() ?? "0.0.0"
            : informational;

        AssetVersion = MakeUrlSafe(Version);
    }

    public string Version { get; }

    public string AssetVersion { get; }

    /// <summary>
    /// Reduce the version to something safe and short enough for a query string.
    ///
    /// The `+` in `1.2.3+abcdef` is not a legal query character; it would decode as a space and
    /// the URL would differ between the HTML and the request. Non-alphanumerics are folded to `-`
    /// and the SHA is truncated, since four hex characters are plenty to distinguish builds while
    /// keeping every asset URL readable.
    /// </summary>
    private static string MakeUrlSafe(string version)
    {
        var plus = version.IndexOf('+');
        if (plus < 0) return Sanitize(version);

        var head = Sanitize(version[..plus]);
        var sha = Sanitize(version[(plus + 1)..]);
        if (sha.Length > 8) sha = sha[..8];
        return sha.Length == 0 ? head : $"{head}-{sha}";
    }

    private static string Sanitize(string value)
    {
        var chars = value.Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' ? c : '-').ToArray();
        return new string(chars).Trim('-');
    }
}
