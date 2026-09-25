namespace Morobot.Domain.Entities;

/// <summary>One cell in a library data source — authoritative store (replaces monolithic CellsJson for reads/writes).</summary>
public class DataSourceCell
{
    public long Id { get; set; }
    public int DataSourceId { get; set; }
    public int RowIndex { get; set; }
    /// <summary>Stable column key (matches <see cref="DataSourceColumnDto.Key"/>).</summary>
    public string ColumnKey { get; set; } = string.Empty;
    public string CellValue { get; set; } = string.Empty;
    /// <summary>Incremented on each write to this cell — concurrent writers on other cells do not conflict.</summary>
    public long CellRevision { get; set; }

    /// <summary>
    /// User who last wrote this cell. Null for cells that came from an Excel import, because an
    /// import has an owner but no single "editor" per cell.
    /// </summary>
    public int? LastEditorUserId { get; set; }

    /// <summary>
    /// When this cell was last written. Null for imported cells — an import stamps the source, not
    /// each of its thousands of cells. A null pair means "inherited from the source", which the UI
    /// shows as the import rather than a person.
    /// </summary>
    public DateTime? UpdatedAtUtc { get; set; }

    public DataSource? DataSource { get; set; }
}
