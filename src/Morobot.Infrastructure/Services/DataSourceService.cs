using ClosedXML.Excel;
using Morobot.Contracts.DataSources;

namespace Morobot.Infrastructure.Services;

/// <summary>Excel parse/export only — data sources live inside Process.GraphJson.</summary>
public class DataSourceService
{
    /// <summary>Parse .xlsx into columns/cells without persisting.</summary>
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

    /// <summary>Rebuild a clean .xlsx from columns + flattened cells.</summary>
    public byte[] BuildExcel(IReadOnlyList<DataSourceColumnDto> columns, IReadOnlyList<DataSourceCellDto> cells)
    {
        if (columns is null || columns.Count == 0)
            throw new InvalidOperationException("منبع ستون معتبری برای خروجی ندارد.");

        using var book = new XLWorkbook();
        var sheet = book.Worksheets.Add("Data");

        for (var c = 0; c < columns.Count; c++)
        {
            var col = columns[c];
            var header = string.IsNullOrWhiteSpace(col.Title) ? col.Key : col.Title;
            sheet.Cell(1, c + 1).Value = header ?? "";
            sheet.Cell(1, c + 1).Style.Font.Bold = true;
        }

        var byRow = new Dictionary<int, Dictionary<string, string>>();
        foreach (var cell in cells ?? Array.Empty<DataSourceCellDto>())
        {
            var idx = cell.Index;
            if (!byRow.TryGetValue(idx, out var row))
            {
                row = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                byRow[idx] = row;
            }
            row[cell.Key ?? ""] = cell.CellValue ?? "";
        }

        var rowIndexes = byRow.Keys.OrderBy(i => i).ToList();
        for (var r = 0; r < rowIndexes.Count; r++)
        {
            var map = byRow[rowIndexes[r]];
            for (var c = 0; c < columns.Count; c++)
            {
                var key = columns[c].Key ?? "";
                map.TryGetValue(key, out var val);
                sheet.Cell(r + 2, c + 1).Value = val ?? "";
            }
        }

        sheet.Columns().AdjustToContents(1, 40);
        using var ms = new MemoryStream();
        book.SaveAs(ms);
        return ms.ToArray();
    }

    internal static (List<DataSourceColumnDto> Columns, List<DataSourceCellDto> Cells) ParseExcel(Stream stream)
    {
        using var book = new XLWorkbook(stream);
        var sheet = book.Worksheets.FirstOrDefault()
            ?? throw new InvalidOperationException("فایل اکسل برگه‌ای برای خواندن ندارد.");
        var range = sheet.RangeUsed();
        if (range is null)
            throw new InvalidOperationException("فایل اکسل خالی است یا جدولی برای تبدیل به منبع ندارد.");

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
}
