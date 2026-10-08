using Microsoft.AspNetCore.SignalR.Client;

namespace Webautomator.Player.Services;

/// <summary>
/// Listens for the server telling this player that a new version exists.
/// </summary>
/// <remarks>
/// A push rather than a poll, because the server already knows when a package changes — it staged
/// it — and asking a desktop client to re-check on a timer spends the client's battery to learn
/// something the server could simply say. The extension's dev-stamp poll is the fallback pattern in
/// this codebase, not the goal; where a push is available it is the better answer.
///
/// The connection is advisory only. If it never connects (an older server, a proxy that strips
/// WebSockets, a firewall) the app still works: the manual "check for updates" button and the
/// launch-time check both use plain HTTP, so a missing push costs promptness, never correctness.
/// </remarks>
public sealed class UpdateListener : IAsyncDisposable
{
    private HubConnection? _connection;
    private readonly string _serverBase;

    /// <summary>Raised when the server announces a version this build does not have.</summary>
    public event Action<UpdateInfo>? UpdateAvailable;

    public UpdateListener(string serverBase) => _serverBase = serverBase.TrimEnd('/');

    /// <summary>
    /// Connect and subscribe. Never throws: a listener that cannot attach is a missing convenience,
    /// and failing startup over it would make an optional feature load-bearing.
    /// </summary>
    public async Task StartAsync()
    {
        if (string.IsNullOrWhiteSpace(_serverBase)) return;
        try
        {
            _connection = new HubConnectionBuilder()
                .WithUrl($"{_serverBase}/hubs/catalog")
                // The same backoff the web panel uses, so a server restart does not leave every
                // player hammering it while it comes back up.
                .WithAutomaticReconnect(new[] { TimeSpan.Zero, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(8) })
                .Build();

            _connection.On<object>("desktopVersion", payload =>
            {
                var info = ParseVersionPayload(payload);
                if (info is null) return;
                if (UpdateService.IsNewer(info.Version, UpdateService.CurrentVersion))
                    UpdateAvailable?.Invoke(info);
            });

            await _connection.StartAsync();
            // Joining the group is what scopes future broadcasts to connected players rather than
            // every client the server has.
            await _connection.InvokeAsync("JoinDesktopPlayers");
        }
        catch
        {
            // Optional by design; see the class remarks.
            _connection = null;
        }
    }

    private static UpdateInfo? ParseVersionPayload(object payload)
    {
        try
        {
            var json = System.Text.Json.JsonSerializer.Serialize(payload);
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            var root = doc.RootElement;
            var version = root.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "";
            if (string.IsNullOrWhiteSpace(version)) return null;
            var url = root.TryGetProperty("downloadUrl", out var d) ? d.GetString() : null;
            return new UpdateInfo(version, true, url);
        }
        catch { return null; }
    }

    public async ValueTask DisposeAsync()
    {
        if (_connection is null) return;
        try { await _connection.DisposeAsync(); } catch { /* already gone */ }
        _connection = null;
    }
}
