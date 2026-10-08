namespace Webautomator.Contracts.DataSources;

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

    /// <summary>Shared source every signed-in user can read and use (see DataSource.IsPublic).</summary>
    public bool IsPublic { get; set; }
    /// <summary>True while a local run's changes for this source have not been synced to the server.</summary>
    public bool NeedsSync { get; set; }
    /// <summary>Owner's username — shown for public sources; null when the owner row is gone.</summary>
    public string? OwnerUserName { get; set; }
    /// <summary>
    /// Whether the CURRENT user may reshape this source (add/rename/remove column). False for a
    /// public source they do not own, which is what the list uses to hide the structural buttons.
    /// </summary>
    public bool CanEditStructure { get; set; }
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

    /// <summary>
    /// How the incoming value meets the value already in the cell:
    /// <c>Replace</c> (default — overwrite), <c>Prepend</c> (incoming first) or <c>Append</c>
    /// (incoming last). The composition happens under the same row lock as the write, so two
    /// writers cannot both read the old value and lose one another's addition. Ignored when the
    /// cell is empty — there is nothing to join with, so the value is stored as-is.
    /// </summary>
    public string? InsertMode { get; set; }

    /// <summary>Text placed between the incoming value and the previous one for Prepend/Append.</summary>
    public string? InsertSeparator { get; set; }
}

public class PatchDataSourceCellResponse
{
    public bool Ok { get; set; }
    /// <summary>Machine-readable failure kind, e.g. <c>source-limit</c>. Null on success.</summary>
    public string? Code { get; set; }
    public long DataRevision { get; set; }
    public long CellRevision { get; set; }
    public string CellValue { get; set; } = string.Empty;
    public bool Conflict { get; set; }
    public long? CurrentDataRevision { get; set; }
    public long? CurrentCellRevision { get; set; }
    public string? CurrentCellValue { get; set; }
    public string? Message { get; set; }

    /// <summary>Editor of the value just written — the grid uses it to refresh the cell tooltip.</summary>
    public int? LastEditorUserId { get; set; }
    public string? LastEditorUserName { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }

    // On a conflict the on-screen value becomes the other writer's, so its stamp is sent back too.
    public int? CurrentCellUserId { get; set; }
    public string? CurrentCellUserName { get; set; }
    public DateTime? CurrentCellUpdatedAtUtc { get; set; }
}

/// <summary>
/// Who last changed one cell and when — surfaced as the grid's cell tooltip.
/// <see cref="UserId"/> is null when the value came from an import rather than a person.
/// </summary>
public class DataSourceCellMetaDto
{
    public int? UserId { get; set; }
    /// <summary>Display name of the last editor, already resolved for the caller.</summary>
    public string? UserName { get; set; }
    public DateTime? UpdatedAtUtc { get; set; }
}

public class DataSourceRowDto
{
    public int RowIndex { get; set; }
    public Dictionary<string, string> Values { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public long DataRevision { get; set; }
}

/// <summary>
/// Bulk row page — one request for a whole table view instead of one request per row.
/// <see cref="CellRevisions"/> carries per-cell revisions so writers keep cell-level concurrency.
/// </summary>
public class DataSourcePageDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<string> ColumnKeys { get; set; } = new();
    public int FromRow { get; set; }
    public int Count { get; set; }
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public long DataRevision { get; set; }
    /// <summary>Opaque token over the returned cell revisions — unchanged token means nothing to re-render.</summary>
    public string HexRevision { get; set; } = string.Empty;
    public List<DataSourceRowDto> Rows { get; set; } = new();
    /// <summary>rowIndex → columnKey → cellRevision (for optimistic writes from the grid).</summary>
    public Dictionary<int, Dictionary<string, long>> CellRevisions { get; set; } = new();
    /// <summary>
    /// rowIndex → columnKey → last editor/time. Tooltip-only: deliberately kept out of the Excel
    /// payload, which is meant to be the data itself and not a change log.
    /// </summary>
    public Dictionary<int, Dictionary<string, DataSourceCellMetaDto>> CellMeta { get; set; } = new();
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

/// <summary>Append one column to a library source (grid context menu → add column).</summary>
public class AddDataSourceColumnRequest
{
    /// <summary>Optional key; a free key is generated when omitted.</summary>
    public string? Key { get; set; }
    public string? Title { get; set; }
    /// <summary>Insert before this 0-based column index; append when omitted.</summary>
    public int? BeforeIndex { get; set; }
}

/// <summary>
/// Rename one column of a library source (grid header edit).
///
/// A column's KEY is what process nodes bind to, so renaming is not cosmetic: the same operation
/// re-points every linked process node that reads or writes the column, keeping the two sides in
/// step. The cells keep their values; only their column key moves.
/// </summary>
public class RenameDataSourceColumnRequest
{
    /// <summary>Current key of the column to rename.</summary>
    public string? OldKey { get; set; }
    /// <summary>New name — becomes both the key and the display title of the column.</summary>
    public string? NewName { get; set; }
}

/// <summary>Insert or append a blank row in a library source.</summary>
public class AddDataSourceRowRequest
{
    /// <summary>Insert before this 0-based row index; append when omitted.</summary>
    public int? BeforeIndex { get; set; }
    public int? Count { get; set; }
}

/// <summary>Result of a structural edit on a source (row/column added).</summary>
public class DataSourceStructureResponse
{
    public bool Ok { get; set; }
    public string? Code { get; set; }
    public string? Message { get; set; }
    public int DataSourceId { get; set; }
    public List<DataSourceColumnDto> Columns { get; set; } = new();
    public List<string> ColumnKeys { get; set; } = new();
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public long DataRevision { get; set; }
    /// <summary>Key of the column that was added, when a column was added.</summary>
    public string? AddedColumnKey { get; set; }
    /// <summary>Key of a column that was renamed (its previous name), when a rename happened.</summary>
    public string? RenamedFromKey { get; set; }
    /// <summary>New key of the renamed column, when a rename happened.</summary>
    public string? RenamedColumnKey { get; set; }
    /// <summary>Key of the column that was deleted, when a column was deleted.</summary>
    public string? DeletedColumnKey { get; set; }
    /// <summary>How many linked processes had node bindings re-pointed by the last operation.</summary>
    public int AffectedProcessCount { get; set; }
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
    public bool IsPublic { get; set; }
}

/// <summary>Toggle whether an owned source is shared with every user.</summary>
public class SetPublicSourceRequest
{
    public bool IsPublic { get; set; }
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
