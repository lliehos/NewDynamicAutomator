using System.Text.Json.Serialization;

namespace Morobot.Licensing;

/// <summary>
/// Describes the contents of an offline update package (a zip whose root holds
/// <see cref="FileName"/> next to the published application files).
/// </summary>
/// <remarks>
/// The same layout is produced by the vendor tooling (LicenseTool / VendorStudio) and
/// consumed by the running server, so the format lives in this shared assembly rather
/// than in either side. Everything the server needs in order to decide whether the
/// package may be applied — the version it targets, which product versions it may
/// upgrade from, and the checksums used to prove the archive arrived intact — is
/// inside the archive itself, so a package stays self-describing when it is carried
/// to a machine that has no network access.
/// </remarks>
public sealed class UpdatePackageManifest
{
    /// <summary>Canonical name of the manifest entry inside the archive.</summary>
    public const string FileName = "morobot-update.json";

    /// <summary>Version this package installs (semver, e.g. "1.2.0").</summary>
    [JsonPropertyName("version")]
    public string Version { get; set; } = "";

    /// <summary>When the vendor built the package.</summary>
    [JsonPropertyName("releasedUtc")]
    public DateTime? ReleasedUtc { get; set; }

    /// <summary>Optional release notes shown to the admin before applying.</summary>
    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    /// <summary>Optional channel label (e.g. "stable", "beta"). Informational only.</summary>
    [JsonPropertyName("channel")]
    public string? Channel { get; set; }

    /// <summary>Oldest product version this package may be applied over. Null = any.</summary>
    [JsonPropertyName("minCurrentVersion")]
    public string? MinCurrentVersion { get; set; }

    /// <summary>Whether the applying install must also have the licence's "updates" entitlement.</summary>
    [JsonPropertyName("requiresUpdateEntitlement")]
    public bool RequiresUpdateEntitlement { get; set; } = true;

    /// <summary>Script inside the archive the updater runs after staging (Windows).</summary>
    [JsonPropertyName("entrypoint")]
    public string? Entrypoint { get; set; }

    /// <summary>Every payload file in the archive, with its integrity data.</summary>
    [JsonPropertyName("files")]
    public List<UpdatePackageFile> Files { get; set; } = new();
}

/// <summary>One payload file recorded inside an <see cref="UpdatePackageManifest"/>.</summary>
public sealed class UpdatePackageFile
{
    /// <summary>Path relative to the archive root, using forward slashes.</summary>
    [JsonPropertyName("path")]
    public string Path { get; set; } = "";

    /// <summary>Lower-case hex SHA-256 of the file contents.</summary>
    [JsonPropertyName("sha256")]
    public string Sha256 { get; set; } = "";

    /// <summary>Uncompressed size in bytes.</summary>
    [JsonPropertyName("size")]
    public long Size { get; set; }
}
