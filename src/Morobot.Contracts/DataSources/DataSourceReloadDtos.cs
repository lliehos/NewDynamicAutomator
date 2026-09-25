namespace Morobot.Contracts.DataSources;

/// <summary>
/// One process node that reads a specific column of a library source. Returned when a reload drops
/// that column so the operator sees exactly which steps would break, not just "a column is gone".
/// </summary>
public class ColumnDependencyNodeDto
{
    /// <summary>Owning process (task) id — the editor route segment.</summary>
    public int ProcessId { get; set; }
    public string ProcessTitle { get; set; } = string.Empty;
    public string NodeId { get; set; } = string.Empty;
    /// <summary>Node kind: action / condition / start.</summary>
    public string Kind { get; set; } = string.Empty;
    /// <summary>Node label as the operator sees it in the canvas.</summary>
    public string NodeTitle { get; set; } = string.Empty;
    /// <summary>Which binding used the column (selector / equal selector / attribute / value / save).</summary>
    public string Binding { get; set; } = string.Empty;
}

/// <summary>One column that the reload would remove while live process nodes still read it.</summary>
public class MissingColumnDto
{
    public string ColumnKey { get; set; } = string.Empty;
    /// <summary>Column title in the *existing* source, for a message an operator recognises.</summary>
    public string ColumnTitle { get; set; } = string.Empty;
    public List<ColumnDependencyNodeDto> Nodes { get; set; } = new();
}

/// <summary>
/// Result of comparing an incoming column set with the columns existing processes depend on.
/// Empty <see cref="MissingColumns"/> means the reload is safe.
/// </summary>
public class ColumnCompatibilityDto
{
    public int DataSourceId { get; set; }
    public string DataSourceTitle { get; set; } = string.Empty;
    /// <summary>Columns present before the reload.</summary>
    public List<string> CurrentColumnKeys { get; set; } = new();
    /// <summary>Columns the incoming file provides.</summary>
    public List<string> IncomingColumnKeys { get; set; } = new();
    /// <summary>Columns only in the incoming file (harmless — nothing depends on them yet).</summary>
    public List<string> AddedColumnKeys { get; set; } = new();
    /// <summary>Columns dropped by the reload that at least one process node reads.</summary>
    public List<MissingColumnDto> MissingColumns { get; set; } = new();
    /// <summary>True when at least one dropped column is still referenced.</summary>
    public bool HasBlockingMissingColumns => MissingColumns.Count > 0;
    /// <summary>Total distinct process nodes that would break.</summary>
    public int AffectedNodeCount { get; set; }
}

/// <summary>Incoming content to push over an existing library source, keeping its id and title.</summary>
public class ReloadDataSourceRequest
{
    public string? FileName { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<DataSourceCellDto> Cells { get; set; } = new();
    public List<string>? ColumnKeys { get; set; }
    public int? ColumnCount { get; set; }
    public int? RowCount { get; set; }
    /// <summary>
    /// Must be set once the operator has seen the missing-column warning and still wants to go on.
    /// Without it a reload that drops a referenced column is refused.
    /// </summary>
    public bool Force { get; set; }
}

/// <summary>Outcome of a reload. <see cref="Ok"/> false means nothing was written.</summary>
public class ReloadDataSourceResponse
{
    public bool Ok { get; set; }
    /// <summary>blocked-missing-columns | notfound | forbidden | invalid</summary>
    public string? Code { get; set; }
    public string? Message { get; set; }
    public int DataSourceId { get; set; }
    public string DataSourceTitle { get; set; } = string.Empty;
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public List<string> ColumnKeys { get; set; } = new();
    public long DataRevision { get; set; }
    /// <summary>Populated when the reload was refused (or forced through) because columns vanished.</summary>
    public ColumnCompatibilityDto? Compatibility { get; set; }
}
