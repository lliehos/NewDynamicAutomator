namespace Morobot.Web.Services;

/// <summary>A staged update package waiting to be applied by the restart helper.</summary>
public sealed record StagedUpdateInfo(string? Version, string? ArchivePath, string? StagedPath, DateTime StagedUtc);

/// <summary>
/// Remembers which offline update package has been staged, so the admin page can show it and
/// the apply action can find it in a later request.
/// </summary>
/// <remarks>
/// In-memory on purpose: the staging folder lives on the same machine as the process, and the
/// staging is discarded by the updater itself once it runs, so persisting this to the database
/// would only create a second source of truth that survives a crash it can no longer trust.
/// After a restart the operator re-uploads, which re-verifies the package — cheap and safe.
/// </remarks>
public sealed class UpdateNotifyStateService
{
    private readonly object _gate = new();
    private StagedUpdateInfo? _staged;

    public StagedUpdateInfo? Staged
    {
        get { lock (_gate) return _staged; }
    }

    public void MarkStaged(string? version, string archivePath, string? stagedPath = null)
    {
        lock (_gate)
            _staged = new StagedUpdateInfo(version, archivePath, stagedPath, DateTime.UtcNow);
    }

    public void Clear()
    {
        lock (_gate) _staged = null;
    }
}
