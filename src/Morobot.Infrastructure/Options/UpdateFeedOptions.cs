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
