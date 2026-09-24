using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Morobot.Contracts.Licensing;
using Morobot.Domain;
using Morobot.Infrastructure.Persistence;

namespace Morobot.Infrastructure.Services;

public sealed class UpdateCheckService
{
    public const string DefaultUpdateUrl = "https://morobot.ir/checkupdate";

    private readonly SystemSettingsService _settings;
    private readonly LicenseService _license;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<UpdateCheckService> _log;

    public UpdateCheckService(
        SystemSettingsService settings,
        LicenseService license,
        IHttpClientFactory http,
        ILogger<UpdateCheckService> log)
    {
        _settings = settings;
        _license = license;
        _http = http;
        _log = log;
    }

    public async Task<UpdateCheckResultDto> GetStatusAsync(CancellationToken ct = default)
    {
        var current = Assembly.GetEntryAssembly()?.GetName().Version?.ToString() ?? "0.0.0";
        var state = await _license.GetRuntimeStateAsync(ct);
        if (!state.AllowsUpdates)
        {
            return new UpdateCheckResultDto
            {
                Allowed = false,
                CurrentVersion = current,
                Message = "Updates are not included in this license."
            };
        }

        var lastCheckRaw = await _settings.GetAsync(SystemSettingKeys.UpdateLastCheckUtc, "", ct);
        DateTime? lastCheck = DateTime.TryParse(lastCheckRaw, out var lc) ? lc : null;
        return new UpdateCheckResultDto
        {
            Allowed = true,
            CurrentVersion = current,
            AvailableVersion = NullIfEmpty(await _settings.GetAsync(SystemSettingKeys.UpdateAvailableVersion, "", ct)),
            ReleaseNotes = NullIfEmpty(await _settings.GetAsync(SystemSettingKeys.UpdateAvailableNotes, "", ct)),
            DownloadUrl = NullIfEmpty(await _settings.GetAsync(SystemSettingKeys.UpdateAvailableUrl, "", ct)),
            LastCheckUtc = lastCheck,
            Message = NullIfEmpty(await _settings.GetAsync(SystemSettingKeys.UpdateAvailableVersion, "", ct)) is not null
                ? "An update is available."
                : null
        };
    }

    public async Task<UpdateCheckResultDto> CheckOnlineAsync(CancellationToken ct = default)
    {
        var status = await GetStatusAsync(ct);
        if (!status.Allowed)
            return status;

        var state = await _license.GetRuntimeStateAsync(ct);
        var configured = await _settings.GetAsync(SystemSettingKeys.UpdateServerUrl, "", ct);
        var url = !string.IsNullOrWhiteSpace(state.Payload?.UpdateServerUrl)
            ? state.Payload!.UpdateServerUrl!
            : !string.IsNullOrWhiteSpace(configured)
                ? configured
                : DefaultUpdateUrl;

        try
        {
            var client = _http.CreateClient(nameof(UpdateCheckService));
            var requestUrl = url.Contains('?', StringComparison.Ordinal)
                ? $"{url}&current={Uri.EscapeDataString(status.CurrentVersion)}"
                : $"{url}?current={Uri.EscapeDataString(status.CurrentVersion)}";
            using var response = await client.GetAsync(requestUrl, ct);
            if (!response.IsSuccessStatusCode)
            {
                status.CheckedOnline = true;
                status.Message = $"Update server returned {(int)response.StatusCode}.";
                return status;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var root = doc.RootElement;
            var latest = ReadVersion(root);
            var notes = ReadString(root, "notes", "releaseNotes", "changelog");
            var download = ReadString(root, "downloadUrl", "download", "url");

            await _settings.SetAsync(SystemSettingKeys.UpdateLastCheckUtc, DateTime.UtcNow.ToString("O"), ct);

            var hasUpdate = ProductUpdateFeedService.IsNewer(latest, status.CurrentVersion);
            if (hasUpdate && !string.IsNullOrWhiteSpace(latest))
            {
                await _settings.SetAsync(SystemSettingKeys.UpdateAvailableVersion, latest!, ct);
                await _settings.SetAsync(SystemSettingKeys.UpdateAvailableNotes, notes ?? "", ct);
                await _settings.SetAsync(SystemSettingKeys.UpdateAvailableUrl, download ?? "", ct);
                status.AvailableVersion = latest;
                status.ReleaseNotes = notes;
                status.DownloadUrl = download;
                status.Message = "A newer version is available.";
            }
            else
            {
                await _settings.SetAsync(SystemSettingKeys.UpdateAvailableVersion, "", ct);
                await _settings.SetAsync(SystemSettingKeys.UpdateAvailableNotes, "", ct);
                await _settings.SetAsync(SystemSettingKeys.UpdateAvailableUrl, "", ct);
                status.AvailableVersion = null;
                status.ReleaseNotes = null;
                status.DownloadUrl = null;
                status.Message = "You are on the latest known version.";
            }

            status.CheckedOnline = true;
            status.LastCheckUtc = DateTime.UtcNow;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Update check failed for {Url}", url);
            status.CheckedOnline = false;
            status.Message = "Could not reach update server. Cached availability is shown if present.";
        }

        return status;
    }

    private static string? ReadVersion(JsonElement root)
    {
        foreach (var name in new[] { "version", "latestVersion", "latest", "Version" })
        {
            if (root.TryGetProperty(name, out var el))
            {
                var s = el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
                if (!string.IsNullOrWhiteSpace(s)) return s.Trim();
            }
        }

        return null;
    }

    private static string? ReadString(JsonElement root, params string[] names)
    {
        foreach (var name in names)
        {
            if (!root.TryGetProperty(name, out var el)) continue;
            var s = el.ValueKind == JsonValueKind.String ? el.GetString() : null;
            if (!string.IsNullOrWhiteSpace(s)) return s.Trim();
        }

        return null;
    }

    private static string? NullIfEmpty(string value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
