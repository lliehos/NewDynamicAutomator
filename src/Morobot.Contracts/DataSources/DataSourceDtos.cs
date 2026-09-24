namespace Morobot.Contracts.DataSources;

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
    public string? FileName { get; set; }
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<string> ColumnKeys { get; set; } = new();
    /// <summary>Processes currently linked to this library source.</summary>
    public int LinkedProcessCount { get; set; }
    public List<string> LinkedProcessTitles { get; set; } = new();
}

public class DataSourceDetailDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? FileName { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<string> ColumnKeys { get; set; } = new();
    /// <summary>Flattened cells as key/index/value.</summary>
    public List<DataSourceCellDto> Cells { get; set; } = new();
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public long DataRevision { get; set; }
}

public class DataSourceMetaDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? FileName { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<string> ColumnKeys { get; set; } = new();
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public long DataRevision { get; set; }
}

public class DataSourceCellValueDto
{
    public int DataSourceId { get; set; }
    public int RowIndex { get; set; }
    public string ColumnKey { get; set; } = string.Empty;
    public string CellValue { get; set; } = string.Empty;
    public long DataRevision { get; set; }
    public long CellRevision { get; set; }
}

public class PatchDataSourceCellRequest
{
    public int RowIndex { get; set; }
    public string ColumnKey { get; set; } = string.Empty;
    public string? CellValue { get; set; }
    /// <summary>Must match server cell revision when updating an existing cell (omit for new cells).</summary>
    public long? ExpectedCellRevision { get; set; }
    [Obsolete("Use ExpectedCellRevision")]
    public long? ExpectedDataRevision { get; set; }
}

public class PatchDataSourceCellResponse
{
    public bool Ok { get; set; }
    public long DataRevision { get; set; }
    public long CellRevision { get; set; }
    public string CellValue { get; set; } = string.Empty;
    public bool Conflict { get; set; }
    public long? CurrentDataRevision { get; set; }
    public long? CurrentCellRevision { get; set; }
    public string? CurrentCellValue { get; set; }
    public string? Message { get; set; }
}

public class DataSourceRowDto
{
    public int RowIndex { get; set; }
    public Dictionary<string, string> Values { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public long DataRevision { get; set; }
}

public class CreateDataSourceRequest
{
    public string? Title { get; set; }
    public string? FileName { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<DataSourceCellDto> Cells { get; set; } = new();
    public List<string>? ColumnKeys { get; set; }
    public int? ColumnCount { get; set; }
    public int? RowCount { get; set; }
}

public class UpdateDataSourceRequest
{
    public string? Title { get; set; }
}

public class UploadDataSourceResponse
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? FileName { get; set; }
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<string> ColumnKeys { get; set; } = new();
    public List<DataSourceCellDto> Cells { get; set; } = new();
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
