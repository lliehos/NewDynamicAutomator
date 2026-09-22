namespace DynamicAutomator.Contracts.DataSources;

/// <summary>Column definition stored as key/value pair.</summary>
public class DataSourceColumnDto
{
    /// <summary>Stable key used in steps/groups (Excel header).</summary>
    public string Key { get; set; } = string.Empty;
    /// <summary>Display title (usually same as key).</summary>
    public string Title { get; set; } = string.Empty;
}

/// <summary>One cell: column key + row index + value.</summary>
public class DataSourceCellDto
{
    public string Key { get; set; } = string.Empty;
    public int Index { get; set; }
    public string CellValue { get; set; } = string.Empty;
}

public class DataSourceListItemDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
}

public class DataSourceDetailDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    /// <summary>Flattened cells as key/index/value.</summary>
    public List<DataSourceCellDto> Cells { get; set; } = new();
    public int RowCount { get; set; }
}

public class UploadDataSourceResponse
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
}

/// <summary>Parsed Excel without persisting — for local-first process properties.</summary>
public class ParsedExcelDto
{
    public string SuggestedTitle { get; set; } = string.Empty;
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<DataSourceCellDto> Cells { get; set; } = new();
    public List<string> ColumnKeys { get; set; } = new();
}

/// <summary>Local-first export: rebuild .xlsx from in-browser source JSON.</summary>
public class ExportExcelRequest
{
    public string? Title { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<DataSourceCellDto> Cells { get; set; } = new();
    public List<string>? ColumnKeys { get; set; }
}
