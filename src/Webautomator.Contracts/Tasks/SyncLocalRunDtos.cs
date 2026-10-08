namespace Webautomator.Contracts.Tasks;

/// <summary>
/// Results of a run that happened on the user's own machine, pushed up by the Sync button.
/// </summary>
/// <remarks>
/// Only the cells the run actually wrote are sent. The client has already warned the user that the
/// server copy may have changed; this payload is the deliberate consequence of that choice.
/// </remarks>
public class SyncLocalRunRequest
{
    /// <summary>When the local run finished, for the audit entry. Optional.</summary>
    public DateTime? LocalRunAt { get; set; }

    /// <summary>The cells to write back to the server.</summary>
    public List<SyncLocalRunCellDto> Cells { get; set; } = new();
}

/// <summary>One cell a local run wrote, addressed the same way the cell API addresses cells.</summary>
public class SyncLocalRunCellDto
{
    public int DataSourceId { get; set; }
    public int RowIndex { get; set; }
    public string ColumnKey { get; set; } = string.Empty;
    public string? CellValue { get; set; }
}

/// <summary>
/// The sources a local run changed, reported when the run ends — before the values are synced.
/// </summary>
/// <remarks>
/// Sent by the client as soon as the local run finishes so the panel can show the sync icon; the
/// values themselves travel later with <see cref="SyncLocalRunRequest"/>. An empty list is a valid
/// report and means "nothing diverged", which is why this is separate from the value push.
/// </remarks>
public class LocalRunChangesRequest
{
    /// <summary>The ids of the sources the run wrote to.</summary>
    public List<int> DataSourceIds { get; set; } = new();
}

/// <summary>
/// The two run settings the desktop player can edit, both of which live on the process's start node.
/// </summary>
public class RunSettingsRequest
{
    /// <summary>Pause between steps, in milliseconds. Clamped to 0..60000.</summary>
    public int StepDelayMs { get; set; }

    /// <summary>The outline colour drawn during a run, as #RRGGBB.</summary>
    public string? HighlightColor { get; set; }
}
