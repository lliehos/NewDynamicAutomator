namespace Morobot.Contracts.Tasks;

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
