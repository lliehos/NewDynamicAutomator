namespace Morobot.Domain.Entities;

public class DataSourceCell
{
    public long Id { get; set; }
    public int DataSourceId { get; set; }
    public int RowIndex { get; set; }
    public string ColumnName { get; set; } = string.Empty;
    public string CellValue { get; set; } = string.Empty;

    public DataSource DataSource { get; set; } = null!;
}
