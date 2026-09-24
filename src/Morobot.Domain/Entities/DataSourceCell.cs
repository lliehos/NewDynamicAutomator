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

    public DataSource? DataSource { get; set; }
}
