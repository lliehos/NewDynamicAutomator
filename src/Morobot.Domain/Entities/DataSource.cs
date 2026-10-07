using Morobot.Domain.Entities;

namespace Morobot.Domain.Entities;

/// <summary>User-owned Excel/data library entry — independent of any process.</summary>
public class DataSource
{
    public int Id { get; set; }
    public int OwnerUserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? FileName { get; set; }
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    /// <summary>JSON array of { key, title }.</summary>
    public string ColumnsJson { get; set; } = "[]";
    /// <summary>Legacy bulk JSON — migrated to <see cref="DataSourceCell"/> rows; kept for export/import fallback.</summary>
    public string CellsJson { get; set; } = "[]";
    /// <summary>Incremented on any cell/metadata write — optimistic concurrency for patch API.</summary>
    public long DataRevision { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public int? LastEditorUserId { get; set; }

    /// <summary>
    /// A shared source every signed-in user can see and use, owned by the ProcessManager who made it.
    /// </summary>
    /// <remarks>
    /// Deliberately a real <see cref="DataSource"/> row rather than a separate entity or an ACL
    /// table: the whole subsystem (cells, rows, columns, linking, the grid API, the editor's source
    /// picker) already keys off a data source id, so a public source that is still a data source
    /// inherits all of it. <see cref="OwnerUserId"/> stays the creator, which is what keeps the
    /// quota and the "who owns this" answer honest.
    ///
    /// Access is split by intent, not by a per-user row: everyone may read it and write cell values
    /// (that is what "use it as an action target" means), while the shape of the source — adding,
    /// renaming or removing columns — stays with ProcessManager/Admin. Row insert/delete is allowed
    /// for everyone, because a run that appends a result row is using the source, not redesigning it.
    /// </remarks>
    public bool IsPublic { get; set; }

    public ICollection<DataSourceCell> Cells { get; set; } = new List<DataSourceCell>();

    public AppUser? Owner { get; set; }
    public AppUser? LastEditor { get; set; }
    public ICollection<ProcessDataSource> ProcessLinks { get; set; } = new List<ProcessDataSource>();
}

/// <summary>Attach a library data source to a process (unlink ≠ delete).</summary>
public class ProcessDataSource
{
    public int ProcessId { get; set; }
    public int DataSourceId { get; set; }
    public bool IsDefault { get; set; }
    public int SortOrder { get; set; }

    public Process? Process { get; set; }
    public DataSource? DataSource { get; set; }
}
