using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Morobot.Licensing;

/// <summary>
/// Reads and writes <see cref="UpdatePackageManifest"/> and the file hashes that back it.
/// Shared by the vendor tooling that produces a package and the server that consumes one.
/// </summary>
public static class UpdatePackageJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true
    };

    public static string Serialize(UpdatePackageManifest manifest)
        => JsonSerializer.Serialize(manifest, Options);

    public static UpdatePackageManifest? TryParse(string json)
    {
        try
        {
            var manifest = JsonSerializer.Deserialize<UpdatePackageManifest>(json, Options);
            return string.IsNullOrWhiteSpace(manifest?.Version) ? null : manifest;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Lower-case hex SHA-256 of a file's contents, used to detect a truncated archive.</summary>
    public static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        return HashStream(stream);
    }

    /// <summary>Lower-case hex SHA-256 of a stream. The stream is read to its end.</summary>
    public static string HashStream(Stream stream)
    {
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(stream)).ToLowerInvariant();
    }

    /// <summary>
    /// Compares two version strings the way the update feed does: parseable, and strictly newer.
    /// Unparseable input is never "newer", which keeps a malformed manifest from being applied.
    /// </summary>
    public static bool IsNewer(string? candidate, string? baseline)
        => !string.IsNullOrWhiteSpace(candidate)
           && Version.TryParse(candidate, out var c)
           && Version.TryParse(baseline, out var b)
           && c > b;

    /// <summary>
    /// True when <paramref name="current"/> satisfies the package's optional floor. A package
    /// without a floor applies over anything; one with a floor refuses a downgrade below it.
    /// </summary>
    public static bool MeetsMinimum(string? current, string? minimum)
    {
        if (string.IsNullOrWhiteSpace(minimum))
            return true;
        if (!Version.TryParse(current, out var c) || !Version.TryParse(minimum, out var m))
            return false;
        return c >= m;
    }
}
