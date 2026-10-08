using System.Globalization;
using System.Reflection;

namespace Webautomator.Web.Services;

/// <summary>
/// A single build stamp for static assets, so a cache-busting query string no longer has to be
/// hand-written and hand-bumped per file.
/// </summary>
/// <remarks>
/// The alternative — the `?v=some-slug-1` tokens scattered across the views — works, but only as
/// long as whoever edits a file remembers to bump its token. Forgetting is silent: the browser
/// keeps serving the old asset and the change looks like it never happened.
///
/// The stamp combines two inputs, because either one alone is wrong:
///
///   1. The assembly's informational version (which includes the git SHA). This catches changes to
///      compiled code.
///   2. The newest write time under `wwwroot`. This catches changes to CSS/JS/images — files that
///      are served straight from disk and never touch the assembly.
///
/// Input (1) alone was the original design, and it quietly failed for exactly the edits that are
/// most common: tweaking a stylesheet produced no new binary, so the SHA never moved, the query
/// string stayed identical, and the browser kept the old file. The symptom is maddening — the fix
/// is verifiably present on disk and in a `no-store` fetch, yet the page still renders the old
/// rules — and it looks like a mistake in the CSS rather than a caching artefact.
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
    public AppVersionService(IWebHostEnvironment env)
    {
        // InformationalVersion is preferred because the SDK stamps it as "<version>+<gitsha>";
        // the informational text is what actually distinguishes two builds of the same version.
        var assembly = Assembly.GetEntryAssembly() ?? typeof(AppVersionService).Assembly;
        var informational = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;

        Version = string.IsNullOrWhiteSpace(informational)
            ? assembly.GetName().Version?.ToString() ?? "0.0.0"
            : informational;

        AssetVersion = MakeUrlSafe(Version) + "-" + StaticAssetStamp(env);
    }

    /// <summary>
    /// A short token that changes whenever any file under `wwwroot` is written.
    /// </summary>
    /// <remarks>
    /// Walks the tree once at startup and takes the newest `LastWriteTimeUtc`, so editing a single
    /// stylesheet is enough to move the stamp. The cost is one directory scan per process start,
    /// which is negligible next to the alternative (a user staring at stale CSS and reporting it as
    /// a bug). Failures degrade to "0" rather than throwing: a cache-busting token must never be
    /// the reason the application cannot start.
    /// </remarks>
    private static string StaticAssetStamp(IWebHostEnvironment? env)
    {
        try
        {
            var root = env?.WebRootPath;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return "0";

            var newest = Directory
                .EnumerateFiles(root, "*", SearchOption.AllDirectories)
                .Select(f => File.GetLastWriteTimeUtc(f))
                .DefaultIfEmpty(DateTime.MinValue)
                .Max();

            if (newest == DateTime.MinValue) return "0";
            // Ticks are too long for a tidy URL; seconds since the Unix epoch are plenty to
            // distinguish one edit from the next and stay short and readable.
            return new DateTimeOffset(newest).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        }
        catch
        {
            return "0";
        }
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
