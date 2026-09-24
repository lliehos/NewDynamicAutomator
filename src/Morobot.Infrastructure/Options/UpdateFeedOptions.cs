namespace Morobot.Infrastructure.Options;

/// <summary>Published product version feed (e.g. morobot.ir/checkupdate).</summary>
public sealed class UpdateFeedOptions
{
    /// <summary>Latest released Morobot version (semver).</summary>
    public string LatestVersion { get; set; } = "";

    public string? ReleaseNotes { get; set; }

    public string? DownloadUrl { get; set; }

    public DateTime? PublishedUtc { get; set; }
}

/// <summary>Where an offline update package is stored between upload and apply.</summary>
public sealed class OfflineUpdateOptions
{
    public const string SectionName = "Morobot:OfflineUpdate";

    /// <summary>Folder holding the uploaded archive. Relative paths resolve under the content root.</summary>
    public string UploadDirectory { get; set; } = "updates/uploaded";

    /// <summary>Folder the archive is extracted into, one sub-folder per version.</summary>
    public string StagingDirectory { get; set; } = "updates/staged";

    /// <summary>Largest accepted archive, in megabytes.</summary>
    public int MaxUploadMegabytes { get; set; } = 512;

    /// <summary>Command the updater runs to bring the application back after the swap.</summary>
    public string? RestartCommand { get; set; }
}
