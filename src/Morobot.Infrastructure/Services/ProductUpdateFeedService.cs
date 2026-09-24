using System.Reflection;
using Microsoft.Extensions.Options;
using Morobot.Contracts.Licensing;
using Morobot.Infrastructure.Options;

namespace Morobot.Infrastructure.Services;

/// <summary>Builds the public update-check payload served at /checkupdate.</summary>
public sealed class ProductUpdateFeedService
{
    private readonly MorobotOptions _options;

    public ProductUpdateFeedService(IOptions<MorobotOptions> options)
    {
        _options = options.Value;
    }

    public ProductUpdateCheckResponse BuildResponse(string? currentVersion)
    {
        var latest = ResolveLatestVersion();
        var current = string.IsNullOrWhiteSpace(currentVersion)
            ? Assembly.GetEntryAssembly()?.GetName().Version?.ToString() ?? "0.0.0"
            : currentVersion.Trim();

        var feed = _options.UpdateFeed;
        return new ProductUpdateCheckResponse
        {
            Version = latest,
            Notes = string.IsNullOrWhiteSpace(feed.ReleaseNotes) ? null : feed.ReleaseNotes.Trim(),
            DownloadUrl = string.IsNullOrWhiteSpace(feed.DownloadUrl) ? null : feed.DownloadUrl.Trim(),
            Current = current,
            UpdateAvailable = IsNewer(latest, current),
            PublishedUtc = feed.PublishedUtc
        };
    }

    public string ResolveLatestVersion()
    {
        var configured = _options.UpdateFeed?.LatestVersion?.Trim();
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var asm = Assembly.GetEntryAssembly()?.GetName().Version;
        return asm?.ToString() ?? "0.0.0";
    }

    internal static bool IsNewer(string? remote, string current)
    {
        if (string.IsNullOrWhiteSpace(remote))
            return false;
        return Version.TryParse(remote, out var r)
               && Version.TryParse(current, out var c)
               && r > c;
    }
}
