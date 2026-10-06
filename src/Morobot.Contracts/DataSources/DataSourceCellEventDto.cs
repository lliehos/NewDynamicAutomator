namespace Morobot.Contracts.DataSources;

/// <summary>Live cell access during play — broadcast to editor viewers via SignalR.</summary>
public class DataSourceCellEventDto
{
    public string TaskId { get; set; } = string.Empty;
    public long DataSourceId { get; set; }
    /// <summary>
    /// read | write — one cell changed. insert | delete — the source's row grid was restructured:
    /// a row was added or removed at <see cref="RowIndex"/>, so every viewer must shift its cached
    /// rows before the next read/write flash lands (otherwise the highlight points at the wrong
    /// row). No <see cref="ColumnKey"/> travels with a structural op.
    /// </summary>
    public string Op { get; set; } = "read";
    public string ColumnKey { get; set; } = string.Empty;
    public int RowIndex { get; set; }
    public string? CellValue { get; set; }
    public string? StepTitle { get; set; }
    public string? UserName { get; set; }

    /// <summary>
    /// Unique per emitted event. The player delivers each event twice — a window event through the
    /// extension's content script and a SignalR broadcast — so viewers use this to apply it once
    /// (a repeated cell write is harmless, a repeated row shift is not). Assigned server-side when
    /// the caller leaves it out.
    /// </summary>
    public string? EventId { get; set; }
}
