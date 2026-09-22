using System.Text.Json;
using ClosedXML.Excel;
using DynamicAutomator.Contracts.DataSources;
using DynamicAutomator.Domain.Entities;
using DynamicAutomator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DynamicAutomator.Infrastructure.Services;

public class DataSourceService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private readonly AppDbContext _db;
    private readonly TaskService _tasks;

    public DataSourceService(AppDbContext db, TaskService tasks)
    {
        _db = db;
        _tasks = tasks;
    }

    public async Task<List<DataSourceListItemDto>> ListForTaskAsync(int userId, int taskId, CancellationToken ct = default)
    {
        if (!await _tasks.CanViewAsync(userId, taskId, ct))
            return new List<DataSourceListItemDto>();

        var sources = await _db.Tasks
            .Where(t => t.Id == taskId)
            .SelectMany(t => t.DataSources)
            .Include(d => d.Cells)
            .OrderBy(d => d.Id)
            .ToListAsync(ct);

        return sources.Select(MapListItem).ToList();
    }

    public async Task<DataSourceDetailDto?> GetAsync(int userId, int id, CancellationToken ct = default)
    {
        var ds = await _db.DataSources
            .Include(d => d.Cells)
            .Include(d => d.Tasks)
            .FirstOrDefaultAsync(d => d.Id == id, ct);
        if (ds is null) return null;

        var taskId = ds.Tasks.Select(t => t.Id).FirstOrDefault();
        if (taskId == 0 || !await _tasks.CanViewAsync(userId, taskId, ct))
            return null;

        return MapDetail(ds);
    }

    public async Task<UploadDataSourceResponse> UploadExcelAsync(
        int userId,
        int taskId,
        string title,
        Stream excelStream,
        CancellationToken ct = default)
    {
        if (!await _tasks.CanModifyAsync(userId, taskId, ct))
            throw new UnauthorizedAccessException();

        var task = await _db.Tasks
            .Include(t => t.DataSources)
            .FirstAsync(t => t.Id == taskId, ct);

        var (columns, cells) = ParseExcel(excelStream);
        if (columns.Count == 0)
            throw new InvalidOperationException("فایل اکسل ستون معتبری ندارد (ردیف اول باید هدر باشد).");

        var ds = new DataSource
        {
            Title = string.IsNullOrWhiteSpace(title) ? $"منبع {DateTime.Now:yyyy-MM-dd HH:mm}" : title.Trim(),
            UserId = userId,
            IsGlobal = false,
            ColumnsJson = JsonSerializer.Serialize(columns, JsonOpts),
            Cells = cells.Select(c => new DataSourceCell
            {
                RowIndex = c.Index,
                ColumnName = c.Key,
                CellValue = c.CellValue
            }).ToList()
        };

        task.DataSources.Add(ds);
        await _db.SaveChangesAsync(ct);

        var rowCount = cells.Count == 0 ? 0 : cells.Max(c => c.Index) + 1;
        return new UploadDataSourceResponse
        {
            Id = ds.Id,
            Title = ds.Title,
            ColumnCount = columns.Count,
            RowCount = rowCount,
            Columns = columns
        };
    }

    /// <summary>Parse .xlsx into columns/cells without attaching to a task (local-first).</summary>
    public ParsedExcelDto ParseExcelOnly(Stream excelStream, string? suggestedTitle = null)
    {
        var (columns, cells) = ParseExcel(excelStream);
        if (columns.Count == 0)
            throw new InvalidOperationException("فایل اکسل ستون معتبری ندارد (ردیف اول باید هدر باشد).");

        var rowCount = cells.Count == 0 ? 0 : cells.Max(c => c.Index) + 1;
        return new ParsedExcelDto
        {
            SuggestedTitle = string.IsNullOrWhiteSpace(suggestedTitle)
                ? $"منبع {DateTime.Now:yyyy-MM-dd HH:mm}"
                : suggestedTitle.Trim(),
            ColumnCount = columns.Count,
            RowCount = rowCount,
            Columns = columns,
            Cells = cells,
            ColumnKeys = columns.Select(c => c.Key).ToList()
        };
    }

    public async Task<bool> DeleteAsync(int userId, int id, CancellationToken ct = default)
    {
        var ds = await _db.DataSources
            .Include(d => d.Tasks)
            .Include(d => d.Cells)
            .FirstOrDefaultAsync(d => d.Id == id, ct);
        if (ds is null) return false;

        var taskId = ds.Tasks.Select(t => t.Id).FirstOrDefault();
        if (taskId == 0 || !await _tasks.CanModifyAsync(userId, taskId, ct))
            throw new UnauthorizedAccessException();

        _db.DataSourceCells.RemoveRange(ds.Cells);
        _db.DataSources.Remove(ds);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// First worksheet must be a clean table: no merges, contiguous header row (non-empty titles),
    /// then data rows. Columns: key=header. Cells: key + index + cellValue.
    /// </summary>
    internal static (List<DataSourceColumnDto> Columns, List<DataSourceCellDto> Cells) ParseExcel(Stream stream)
    {
        using var book = new XLWorkbook(stream);
        var sheet = book.Worksheets.FirstOrDefault()
            ?? throw new InvalidOperationException("فایل اکسل برگه‌ای برای خواندن ندارد.");
        var range = sheet.RangeUsed();
        if (range is null)
            throw new InvalidOperationException("فایل اکسل خالی است یا جدولی برای تبدیل به منبع ندارد.");

        // Clean table: merged cells break stable column keys / row mapping.
        foreach (var merge in sheet.MergedRanges)
        {
            if (merge.Intersects(range))
            {
                throw new InvalidOperationException(
                    "اکسل باید جدول تمیز باشد — سلول ادغام‌شده (Merge) مجاز نیست.");
            }
        }

        var firstRow = range.FirstRow().RowNumber();
        var lastRow = range.LastRow().RowNumber();
        var firstCol = range.FirstColumn().ColumnNumber();
        var lastCol = range.LastColumn().ColumnNumber();

        // Trim trailing empty header cells so used-range padding does not invent columns.
        while (lastCol >= firstCol)
        {
            var h = sheet.Cell(firstRow, lastCol).GetString()?.Trim() ?? "";
            if (!string.IsNullOrWhiteSpace(h)) break;
            lastCol--;
        }
        if (lastCol < firstCol)
            throw new InvalidOperationException("سطر اول باید هدر ستون‌های معتبر داشته باشد.");

        var columns = new List<DataSourceColumnDto>();
        var usedKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var c = firstCol; c <= lastCol; c++)
        {
            var raw = sheet.Cell(firstRow, c).GetString()?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(raw))
            {
                throw new InvalidOperationException(
                    $"هدر ستون در موقعیت {c - firstCol + 1} خالی است — سطر اول باید عنوان همهٔ ستون‌ها را داشته باشد.");
            }
            if (raw.Length > 120)
            {
                throw new InvalidOperationException(
                    $"عنوان ستون «{raw[..Math.Min(40, raw.Length)]}…» بیش از حد طولانی است.");
            }
            var key = raw;
            var n = 2;
            while (!usedKeys.Add(key))
            {
                key = $"{raw}_{n}";
                n++;
            }
            columns.Add(new DataSourceColumnDto { Key = key, Title = raw });
        }

        if (columns.Count == 0)
            throw new InvalidOperationException("فایل اکسل ستون معتبری ندارد (ردیف اول باید هدر باشد).");

        if (lastRow <= firstRow)
            throw new InvalidOperationException("جدول فقط هدر دارد — حداقل یک سطر داده لازم است.");

        var cells = new List<DataSourceCellDto>();
        var dataIndex = 0;
        for (var r = firstRow + 1; r <= lastRow; r++)
        {
            var rowValues = new List<string>();
            var any = false;
            for (var i = 0; i < columns.Count; i++)
            {
                var cell = sheet.Cell(r, firstCol + i);
                var text = cell.GetFormattedString()?.Trim() ?? cell.GetString()?.Trim() ?? "";
                if (!string.IsNullOrEmpty(text)) any = true;
                rowValues.Add(text);
            }
            if (!any) continue;
            for (var i = 0; i < columns.Count; i++)
            {
                cells.Add(new DataSourceCellDto
                {
                    Key = columns[i].Key,
                    Index = dataIndex,
                    CellValue = rowValues[i]
                });
            }
            dataIndex++;
        }

        if (dataIndex == 0)
            throw new InvalidOperationException("هیچ سطر داده‌ای در جدول پیدا نشد.");

        return (columns, cells);
    }

    private static DataSourceListItemDto MapListItem(DataSource ds)
    {
        var cols = ReadColumns(ds.ColumnsJson);
        var rowCount = ds.Cells.Count == 0 ? 0 : ds.Cells.Max(c => c.RowIndex) + 1;
        return new DataSourceListItemDto
        {
            Id = ds.Id,
            Title = ds.Title,
            ColumnCount = cols.Count,
            RowCount = rowCount,
            Columns = cols
        };
    }

    private static DataSourceDetailDto MapDetail(DataSource ds)
    {
        var cols = ReadColumns(ds.ColumnsJson);
        var cells = ds.Cells
            .OrderBy(c => c.RowIndex)
            .ThenBy(c => c.ColumnName)
            .Select(c => new DataSourceCellDto
            {
                Key = c.ColumnName,
                Index = c.RowIndex,
                CellValue = c.CellValue
            })
            .ToList();
        return new DataSourceDetailDto
        {
            Id = ds.Id,
            Title = ds.Title,
            Columns = cols,
            Cells = cells,
            RowCount = cells.Count == 0 ? 0 : cells.Max(c => c.Index) + 1
        };
    }

    private static List<DataSourceColumnDto> ReadColumns(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<DataSourceColumnDto>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                var list = new List<DataSourceColumnDto>();
                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    if (el.ValueKind == JsonValueKind.String)
                    {
                        var s = el.GetString() ?? "";
                        list.Add(new DataSourceColumnDto { Key = s, Title = s });
                    }
                    else if (el.ValueKind == JsonValueKind.Object)
                    {
                        var key = el.TryGetProperty("key", out var k) ? k.GetString()
                            : el.TryGetProperty("Key", out var k2) ? k2.GetString() : null;
                        var title = el.TryGetProperty("title", out var t) ? t.GetString()
                            : el.TryGetProperty("Title", out var t2) ? t2.GetString() : key;
                        if (!string.IsNullOrWhiteSpace(key))
                            list.Add(new DataSourceColumnDto { Key = key!, Title = title ?? key! });
                    }
                }
                return list;
            }
        }
        catch
        {
            /* fall through */
        }
        return new List<DataSourceColumnDto>();
    }
}
