using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;

namespace Morobot.Desktop.Services;

/// <summary>What the server says the current runner build is.</summary>
public sealed record UpdateInfo(string Version, bool Available, string? DownloadUrl);

/// <summary>
/// Checks for, downloads and applies a newer runner build.
/// </summary>
/// <remarks>
/// Update is a two-step operation on Windows by necessity: a running executable cannot replace
/// itself. The app therefore unpacks the new build beside the old one and exits with the new copy
/// started; the swap happens while nothing holds the old file.
///
/// The version check is deliberately unauthenticated — it runs before sign-in, so a client too old
/// to talk to the current server can still be told to update instead of failing at login with a
/// confusing protocol error.
/// </remarks>
public sealed class UpdateService
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(5) };

    public static string CurrentVersion =>
        Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";

    /// <summary>Ask the server for its current desktop build. Null when the server is unreachable.</summary>
    public static async Task<UpdateInfo?> CheckAsync(string serverBase, CancellationToken ct = default)
    {
        try
        {
            var url = $"{serverBase.TrimEnd('/')}/desktop/version";
            var json = await Http.GetStringAsync(url, ct);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var version = root.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "";
            var available = root.TryGetProperty("available", out var a) && a.ValueKind == JsonValueKind.True;
            var downloadUrl = root.TryGetProperty("downloadUrl", out var d) ? d.GetString() : null;
            return new UpdateInfo(version, available, downloadUrl);
        }
        catch
        {
            // Offline is normal for a local runner; it must not be reported as an update failure.
            return null;
        }
    }

    /// <summary>True when <paramref name="serverVersion"/> is newer than this build.</summary>
    public static bool IsNewer(string serverVersion, string? currentVersion = null)
    {
        var current = currentVersion ?? CurrentVersion;
        if (Version.TryParse(Normalize(serverVersion), out var remote)
            && Version.TryParse(Normalize(current), out var local))
            return remote > local;
        return false;
    }

    private static string Normalize(string v)
    {
        // "1.2" and "1.2.0" must compare equal rather than fail to parse.
        var parts = (v ?? "").Split('.', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length switch
        {
            0 => "0.0.0",
            1 => $"{parts[0]}.0.0",
            2 => $"{parts[0]}.{parts[1]}.0",
            _ => $"{parts[0]}.{parts[1]}.{parts[2]}"
        };
    }

    /// <summary>
    /// Download the new build, unpack it, and hand off to it.
    /// </summary>
    /// <returns>The path of the new executable to start, or null on failure.</returns>
    public static async Task<(bool ok, string? newExe, string? error)> DownloadAndStageAsync(
        string serverBase, string downloadUrl, IProgress<int>? progress = null, CancellationToken ct = default)
    {
        try
        {
            var url = downloadUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                ? downloadUrl
                : $"{serverBase.TrimEnd('/')}{downloadUrl}";

            var stagingDir = Path.Combine(Path.GetTempPath(), "MorobotDesktopUpd", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stagingDir);

            var zipPath = Path.Combine(stagingDir, "update.zip");
            using (var res = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct))
            {
                res.EnsureSuccessStatusCode();
                var total = res.Content.Headers.ContentLength ?? -1;
                await using var src = await res.Content.ReadAsStreamAsync(ct);
                await using var dst = File.Create(zipPath);
                var buffer = new byte[81920];
                long read = 0;
                int n;
                while ((n = await src.ReadAsync(buffer, ct)) > 0)
                {
                    await dst.WriteAsync(buffer.AsMemory(0, n), ct);
                    read += n;
                    if (total > 0) progress?.Report((int)(read * 100 / total));
                }
            }

            var extractDir = Path.Combine(stagingDir, "app");
            ZipFile.ExtractToDirectory(zipPath, extractDir);

            // The zip may nest the build one level down (a packaged folder); find the exe rather than
            // assuming a layout, so either packaging works.
            var exe = Directory.EnumerateFiles(extractDir, "Morobot.Desktop.exe", SearchOption.AllDirectories)
                .FirstOrDefault();
            if (exe is null) return (false, null, "فایل اجرایی در بستهٔ به‌روزرسانی پیدا نشد.");

            return (true, exe, null);
        }
        catch (Exception ex)
        {
            return (false, null, $"دانلود به‌روزرسانی ناموفق بود: {ex.Message}");
        }
    }
}
