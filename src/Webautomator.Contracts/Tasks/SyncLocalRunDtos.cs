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

    /// <summary>
    /// Rows the local run INSERTED (per source), so the sync materialises them where the run saw them.
    /// </summary>
    /// <remarks>
    /// Appending rows from <c>max(RowIndex)</c> is only right when every new row is at the end. A run
    /// that inserts in the middle writes into rows below it, and on the server that index belongs to a
    /// different record — appending there would put the run's values next to the wrong data and report
    /// those cells as conflicts. Optional: an older client sends none and keeps the old behaviour.
    /// </remarks>
    public List<SyncLocalRunRowDto> Rows { get; set; } = new();

    /// <summary>
    /// Rows the local run DELETED (per source), so the sync removes them before the values arrive.
    /// </summary>
    /// <remarks>
    /// Deleting locally shifts every row below it up, so the payload's indexes are already one lower
    /// than the server's there. Deleting on the server first puts both copies on the same numbering;
    /// without it every row under a deleted one would be written into a row that holds a different
    /// record, and the merge would report those cells as conflicts.
    /// </remarks>
    public List<SyncLocalRunRowDto> DeletedRows { get; set; } = new();
}

/// <summary>One row a local run inserted, addressed by the index it used in the local copy.</summary>
public class SyncLocalRunRowDto
{
    public int DataSourceId { get; set; }

    /// <summary>The 0-based row index the inserted row occupies in the LOCAL copy.</summary>
    public int RowIndex { get; set; }
}

/// <summary>One cell a local run wrote, addressed the same way the cell API addresses cells.</summary>
public class SyncLocalRunCellDto
{
    public int DataSourceId { get; set; }
    public int RowIndex { get; set; }
    public string ColumnKey { get; set; } = string.Empty;
    public string? CellValue { get; set; }

    /// <summary>
    /// The value the cell held in the copy the local run started from (the server's value at load).
    /// The sync merges with it: when the server's current value still equals this, nobody else has
    /// touched the cell and the run's value is written; when it differs, the server's newer value is
    /// kept and the cell is reported back as a conflict. <c>null</c> means the client could not know
    /// it (an older client, or a cell the local copy never carried) — the write then proceeds.
    /// </summary>
    public string? BaseValue { get; set; }
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
