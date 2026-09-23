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
    /// <summary>JSON array of { key, index, cellValue }.</summary>
    public string CellsJson { get; set; } = "[]";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

    public AppUser? Owner { get; set; }
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
