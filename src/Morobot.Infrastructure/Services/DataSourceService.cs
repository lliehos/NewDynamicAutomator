using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ClosedXML.Excel;
using Morobot.Contracts.Auth;
using Morobot.Contracts.DataSources;
using Morobot.Domain.Entities;
using Morobot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Morobot.Infrastructure.Services;

/// <summary>User library of Excel data sources + Excel parse/export. Process links are independent of library lifetime.</summary>
public class DataSourceService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private readonly AppDbContext _db;
    private readonly EntitlementService _entitlements;
    private readonly ILogger<DataSourceService> _log;

    public DataSourceService(AppDbContext db, EntitlementService entitlements, ILogger<DataSourceService> log)
    {
        _db = db;
        _entitlements = entitlements;
        _log = log;
    }

    public Task<List<int>> GetLinkedProcessIdsAsync(int dataSourceId, CancellationToken ct = default)
        => _db.ProcessDataSources.AsNoTracking()
            .Where(l => l.DataSourceId == dataSourceId)
            .Select(l => l.ProcessId)
            .Distinct()
            .ToListAsync(ct);

    static void StampDataEditor(DataSource entity, int userId)
    {
        if (userId > 0)
            entity.LastEditorUserId = userId;
    }

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

    public async Task<List<DataSourceListItemDto>> ListForUserAsync(int userId, CancellationToken ct = default)
    {
        var rows = await _db.DataSources.AsNoTracking()
            .Where(d => d.OwnerUserId == userId)
            .OrderByDescending(d => d.UpdatedAtUtc)
            .Select(d => new
            {
                d.Id,
                d.Title,
                d.FileName,
                d.ColumnCount,
                d.RowCount,
                d.ColumnsJson,
                Links = d.ProcessLinks.Select(l => l.Process!.Title).ToList()
            })
            .ToListAsync(ct);

        return rows.Select(d =>
        {
            var cols = DeserializeColumns(d.ColumnsJson);
            return new DataSourceListItemDto
            {
                Id = d.Id,
                Title = d.Title,
                FileName = d.FileName,
                ColumnCount = d.ColumnCount,
                RowCount = d.RowCount,
                Columns = cols,
                ColumnKeys = cols.Select(c => c.Key).ToList(),
                LinkedProcessCount = d.Links.Count,
                LinkedProcessTitles = d.Links
            };
        }).ToList();
    }

    public async Task<List<AdminLibrarySourceRow>> ListAllForAdminAsync(CancellationToken ct = default)
    {
        var rows = await _db.DataSources.AsNoTracking()
            .OrderByDescending(d => d.UpdatedAtUtc)
            .Select(d => new
            {
                d.Id,
                d.Title,
                OwnerUserName = d.Owner != null ? d.Owner.UserName : "—",
                LastEditorUserName = d.LastEditor != null ? d.LastEditor.UserName : null,
                d.ColumnCount,
                d.RowCount,
                d.FileName,
                d.CreatedAtUtc,
                d.UpdatedAtUtc,
                LinkedProcessCount = d.ProcessLinks.Count,
                Titles = d.ProcessLinks.Select(l => l.Process != null ? l.Process.Title : "?").ToList()
            })
            .ToListAsync(ct);

        return rows.Select(d => new AdminLibrarySourceRow
        {
            Id = d.Id,
            Title = d.Title,
            OwnerUserName = d.OwnerUserName,
            LastEditorUserName = d.LastEditorUserName,
            ColumnCount = d.ColumnCount,
            RowCount = d.RowCount,
            FileName = d.FileName,
            CreatedAtUtc = d.CreatedAtUtc,
            UpdatedAtUtc = d.UpdatedAtUtc,
            LinkedProcessCount = d.LinkedProcessCount,
            LinkedProcessTitles = string.Join("، ", d.Titles)
        }).ToList();
    }

    public async Task<DataSourceDetailDto?> GetAsync(int userId, int id, CancellationToken ct = default)
    {
        var d = await GetAccessibleAsync(userId, id, write: false, ct);
        if (d is null) return null;
        var cells = await LoadCellsFromDbAsync(id, ct);
        if (cells.Count == 0)
            cells = DeserializeCells(d.CellsJson);
        return ToDetail(d, cells);
    }

    /// <summary>Admin-only: load any library source by id (no owner check).</summary>
    public async Task<DataSourceDetailDto?> GetForAdminAsync(int id, CancellationToken ct = default)
    {
        var d = await _db.DataSources.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (d is null) return null;
        var cells = await LoadCellsFromDbAsync(id, ct);
        if (cells.Count == 0)
            cells = DeserializeCells(d.CellsJson);
        return ToDetail(d, cells);
    }

    public async Task<UploadDataSourceResponse> CreateAsync(
        int userId, CreateDataSourceRequest req, EntitlementsDto? entitlements = null, CancellationToken ct = default)
    {
        entitlements ??= await ResolveEntitlements(userId, ct);
        await _entitlements.EnsureCanCreateDataSourceAsync(userId, entitlements, ct);

        var columns = NormalizeColumns(req.Columns, req.ColumnKeys);
        if (columns.Count == 0)
            throw new InvalidOperationException("منبع ستون معتبری ندارد.");
        var cells = req.Cells ?? new List<DataSourceCellDto>();
        var rowCount = req.RowCount ?? (cells.Count == 0 ? 0 : cells.Max(c => c.Index) + 1);
        var title = string.IsNullOrWhiteSpace(req.Title)
            ? $"منبع {DateTime.UtcNow:yyyy-MM-dd HH:mm}"
            : req.Title.Trim();
        if (title.Length > 200) title = title[..200];

        var entity = new DataSource
        {
            OwnerUserId = userId,
            Title = title,
            FileName = Trunc(req.FileName, 260),
            ColumnCount = req.ColumnCount ?? columns.Count,
            RowCount = rowCount,
            ColumnsJson = JsonSerializer.Serialize(columns, JsonOpts),
            CellsJson = JsonSerializer.Serialize(cells, JsonOpts),
            CreatedAtUtc = DateTime.UtcNow,
            UpdatedAtUtc = DateTime.UtcNow,
            LastEditorUserId = userId > 0 ? userId : null
        };
        _db.DataSources.Add(entity);
        await _db.SaveChangesAsync(ct);
        await ReplaceAllCellsAsync(entity.Id, cells, ct);
        entity.DataRevision = 1;
        entity.CellsJson = JsonSerializer.Serialize(cells, JsonOpts);
        await _db.SaveChangesAsync(ct);
        return ToUploadResponse(entity, columns, cells);
    }

    public async Task<DataSourceMetaDto?> GetMetaAsync(int userId, int id, CancellationToken ct = default)
    {
        var d = await GetAccessibleAsync(userId, id, write: false, ct);
        return d is null ? null : ToMeta(d);
    }

    public async Task<DataSourceCellValueDto?> GetCellAsync(
        int userId, int id, int rowIndex, string columnKey, CancellationToken ct = default)
    {
        var d = await GetAccessibleAsync(userId, id, write: false, ct);
        if (d is null) return null;
        var key = (columnKey ?? "").Trim();
        if (string.IsNullOrEmpty(key)) return null;
        var cell = await _db.DataSourceCells.AsNoTracking()
            .FirstOrDefaultAsync(c => c.DataSourceId == id && c.RowIndex == rowIndex && c.ColumnKey == key, ct);
        return new DataSourceCellValueDto
        {
            DataSourceId = id,
            RowIndex = rowIndex,
            ColumnKey = key,
            CellValue = cell?.CellValue ?? "",
            DataRevision = d.DataRevision,
            CellRevision = cell?.CellRevision ?? 0
        };
    }

    public async Task<DataSourceRowDto?> GetRowAsync(
        int userId, int id, int rowIndex, CancellationToken ct = default)
    {
        var d = await GetAccessibleAsync(userId, id, write: false, ct);
        if (d is null) return null;
        var cells = await _db.DataSourceCells.AsNoTracking()
            .Where(c => c.DataSourceId == id && c.RowIndex == rowIndex)
            .ToListAsync(ct);
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in cells)
            map[c.ColumnKey] = c.CellValue ?? "";
        return new DataSourceRowDto
        {
            RowIndex = rowIndex,
            Values = map,
            DataRevision = Math.Max(d.DataRevision, cells.Count == 0 ? 0 : cells.Max(c => c.CellRevision))
        };
    }

    /// <summary>
    /// Bulk row page for "view all rows" screens: one round trip instead of one request per row.
    /// Optionally filtered to a column-key set so callers only pull what they render.
    /// </summary>
    public async Task<DataSourcePageDto?> GetRowsPageAsync(
        int userId, int id, int fromRow, int count, IReadOnlyList<string>? columnKeys, CancellationToken ct = default)
    {
        var d = await GetAccessibleAsync(userId, id, write: false, ct);
        if (d is null) return null;
        if (fromRow < 0) fromRow = 0;
        count = Math.Clamp(count, 1, 5000);

        var q = _db.DataSourceCells.AsNoTracking()
            .Where(c => c.DataSourceId == id && c.RowIndex >= fromRow && c.RowIndex < fromRow + count);

        if (columnKeys is { Count: > 0 })
        {
            var keys = columnKeys.Where(k => !string.IsNullOrWhiteSpace(k)).Select(k => k.Trim()).Distinct().ToList();
            if (keys.Count > 0)
                q = q.Where(c => keys.Contains(c.ColumnKey));
        }

        var rows = await q
            .OrderBy(c => c.RowIndex)
            .ThenBy(c => c.ColumnKey)
            .Select(c => new { c.RowIndex, c.ColumnKey, c.CellValue, c.CellRevision })
            .ToListAsync(ct);

        var byRow = new Dictionary<int, DataSourceRowDto>();
        var revisions = new Dictionary<int, Dictionary<string, long>>();
        long maxCellRevision = 0;
        foreach (var c in rows)
        {
            if (!byRow.TryGetValue(c.RowIndex, out var row))
            {
                row = new DataSourceRowDto { RowIndex = c.RowIndex };
                byRow[c.RowIndex] = row;
                revisions[c.RowIndex] = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            }
            row.Values[c.ColumnKey] = c.CellValue ?? "";
            revisions[c.RowIndex][c.ColumnKey] = c.CellRevision;
            if (c.CellRevision > maxCellRevision) maxCellRevision = c.CellRevision;
        }

        var cols = DeserializeColumns(d.ColumnsJson);
        return new DataSourcePageDto
        {
            Id = d.Id,
            Title = d.Title,
            Columns = cols,
            ColumnKeys = cols.Select(c => c.Key).ToList(),
            FromRow = fromRow,
            Count = count,
            ColumnCount = d.ColumnCount,
            RowCount = Math.Max(d.RowCount, byRow.Count == 0 ? 0 : byRow.Keys.Max() + 1),
            DataRevision = d.DataRevision == 0 ? maxCellRevision : d.DataRevision,
            HexRevision = BuildRevisionToken(rows.Select(r => (r.RowIndex, r.ColumnKey, r.CellRevision))),
            Rows = byRow.Values.OrderBy(r => r.RowIndex).ToList(),
            CellRevisions = revisions
        };
    }

    /// <summary>Stable token over the returned cell revisions — lets callers skip re-rendering unchanged pages.</summary>
    public static string BuildRevisionToken(IEnumerable<(int row, string col, long rev)> cells)
    {
        var sb = new StringBuilder();
        foreach (var (row, col, rev) in cells.OrderBy(c => c.row).ThenBy(c => c.col, StringComparer.Ordinal))
            sb.Append(row).Append(':').Append(col).Append(':').Append(rev).Append(';');
        if (sb.Length == 0) return "0";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()));
        return Convert.ToHexString(bytes, 0, 8).ToLowerInvariant();
    }

    public async Task<PatchDataSourceCellResponse> PatchCellAsync(
        int userId, int id, PatchDataSourceCellRequest req, CancellationToken ct = default)
    {
        var key = (req.ColumnKey ?? "").Trim();
        if (string.IsNullOrEmpty(key) || req.RowIndex < 0)
        {
            return new PatchDataSourceCellResponse
            {
                Ok = false,
                Message = "ردیف یا ستون نامعتبر است."
            };
        }

        var d = await GetAccessibleAsync(userId, id, write: true, ct);
        if (d is null)
        {
            return new PatchDataSourceCellResponse { Ok = false, Message = "forbidden" };
        }

        var value = req.CellValue ?? "";
        var expectedRev = req.ExpectedCellRevision;

        // One shot, no server-side retry loop: the caller (player/editor) owns retry policy.
        // Retrying here while holding a transaction would keep a row lock alive and make
        // concurrent writers on *different* cells of the same source queue up.
        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            var ds = await _db.DataSources.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (ds is null)
            {
                await tx.RollbackAsync(ct);
                return new PatchDataSourceCellResponse { Ok = false, Message = "forbidden" };
            }

            var locked = await _db.DataSourceCells
                .FromSqlInterpolated(
                    $"SELECT * FROM DataSourceCells WITH (UPDLOCK, ROWLOCK) WHERE DataSourceId = {id} AND RowIndex = {req.RowIndex} AND ColumnKey = {key}")
                .AsTracking()
                .FirstOrDefaultAsync(ct);

            if (locked is not null
                && expectedRev is long exp
                && locked.CellRevision != exp)
            {
                await tx.RollbackAsync(ct);
                return new PatchDataSourceCellResponse
                {
                    Ok = false,
                    Conflict = true,
                    Message = "سلول توسط کاربر دیگری تغییر کرده است.",
                    DataRevision = ds.DataRevision,
                    CurrentDataRevision = ds.DataRevision,
                    CurrentCellRevision = locked.CellRevision,
                    CurrentCellValue = locked.CellValue
                };
            }

            if (locked is null)
            {
                // A concurrent writer may have inserted the same cell between our lock attempt and now.
                var exists = await _db.DataSourceCells.AsNoTracking()
                    .AnyAsync(c => c.DataSourceId == id && c.RowIndex == req.RowIndex && c.ColumnKey == key, ct);
                if (exists)
                {
                    await tx.RollbackAsync(ct);
                    return new PatchDataSourceCellResponse
                    {
                        Ok = false,
                        Conflict = true,
                        Message = "سلول همزمان توسط نویسنده دیگری ایجاد شد."
                    };
                }

                locked = new DataSourceCell
                {
                    DataSourceId = id,
                    RowIndex = req.RowIndex,
                    ColumnKey = key,
                    CellValue = value,
                    CellRevision = 1
                };
                _db.DataSourceCells.Add(locked);
            }
            else
            {
                locked.CellValue = value;
                locked.CellRevision++;
            }

            // Do NOT touch the DataSources row on the hot path: writing DataRevision/RowCount/
            // UpdatedAtUtc here would take a second lock on the parent row and serialise every
            // writer of this source, even when they edit entirely different cells.
            // DataRevision is derived from MAX(CellRevision) and RowCount from MAX(RowIndex).
            await _db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            // Parent row is untouched on purpose, so report the derived source revision.
            var (derivedRevision, _) = await GetDerivedCountersAsync(id, ct);

            return new PatchDataSourceCellResponse
            {
                Ok = true,
                DataRevision = Math.Max(derivedRevision, locked.CellRevision),
                CellRevision = locked.CellRevision,
                CellValue = value
            };
        }
        catch (Exception ex)
        {
            try { await tx.RollbackAsync(ct); } catch { /* ignore */ }
            _log.LogDebug(ex, "PatchCell failed ds={Ds} r={Row} c={Col}", id, req.RowIndex, key);
            return new PatchDataSourceCellResponse
            {
                Ok = false,
                Message = "نوشتن سلول انجام نشد — دوباره تلاش کنید."
            };
        }
    }

    /// <summary>Derived counters — avoids writing the parent row on every cell write.</summary>
    public async Task<(long dataRevision, int rowCount)> GetDerivedCountersAsync(int id, CancellationToken ct = default)
    {
        var agg = await _db.DataSourceCells.AsNoTracking()
            .Where(c => c.DataSourceId == id)
            .GroupBy(c => 1)
            .Select(g => new
            {
                MaxCellRevision = g.Max(c => (long?)c.CellRevision) ?? 0L,
                MaxRowIndex = g.Max(c => (int?)c.RowIndex) ?? -1
            })
            .FirstOrDefaultAsync(ct);
        return (agg?.MaxCellRevision ?? 0L, (agg?.MaxRowIndex ?? -1) + 1);
    }

    async Task ReplaceAllCellsAsync(int dataSourceId, IReadOnlyList<DataSourceCellDto> cells, CancellationToken ct)
    {
        var existing = await _db.DataSourceCells.Where(c => c.DataSourceId == dataSourceId).ToListAsync(ct);
        if (existing.Count > 0)
            _db.DataSourceCells.RemoveRange(existing);
        foreach (var c in cells ?? Array.Empty<DataSourceCellDto>())
        {
            var key = (c.Key ?? "").Trim();
            if (string.IsNullOrEmpty(key)) continue;
            _db.DataSourceCells.Add(new DataSourceCell
            {
                DataSourceId = dataSourceId,
                RowIndex = c.Index,
                ColumnKey = key,
                CellValue = c.CellValue ?? ""
            });
        }
        await _db.SaveChangesAsync(ct);
    }

    async Task<List<DataSourceCellDto>> LoadCellsFromDbAsync(int dataSourceId, CancellationToken ct)
    {
        return await _db.DataSourceCells.AsNoTracking()
            .Where(c => c.DataSourceId == dataSourceId)
            .OrderBy(c => c.RowIndex)
            .ThenBy(c => c.ColumnKey)
            .Select(c => new DataSourceCellDto
            {
                Key = c.ColumnKey,
                Index = c.RowIndex,
                CellValue = c.CellValue
            })
            .ToListAsync(ct);
    }

    async Task<DataSource?> GetAccessibleAsync(int userId, int dataSourceId, bool write, CancellationToken ct)
    {
        var ds = await _db.DataSources.FirstOrDefaultAsync(d => d.Id == dataSourceId, ct);
        if (ds is null) return null;
        if (ds.OwnerUserId == userId)
        {
            await EnsureLegacyCellsMaterializedAsync(ds, ct);
            return ds;
        }

        var can = await (
            from l in _db.ProcessDataSources
            where l.DataSourceId == dataSourceId
            join p in _db.Processes on l.ProcessId equals p.Id
            where p.CreatorUserId == userId
                  || _db.ProcessShares.Any(s =>
                      s.ProcessId == p.Id && s.UserId == userId
                      && (!write || s.CanChangeDataSource || s.CanEdit))
            select l.ProcessId
        ).AnyAsync(ct);
        if (!can) return null;
        await EnsureLegacyCellsMaterializedAsync(ds, ct);
        return ds;
    }

    /// <summary>
    /// Guard for the legacy CellsJson materialisation. Cached per service instance so the common
    /// read path does not pay an extra EXISTS query on every single cell access.
    /// </summary>
    private readonly HashSet<int> _materializedChecked = new();

    async Task EnsureLegacyCellsMaterializedAsync(DataSource d, CancellationToken ct)
    {
        if (!_materializedChecked.Add(d.Id)) return;
        if (await _db.DataSourceCells.AnyAsync(c => c.DataSourceId == d.Id, ct))
            return;
        var legacy = DeserializeCells(d.CellsJson);
        if (legacy.Count == 0) return;
        await ReplaceAllCellsAsync(d.Id, legacy, ct);
        if (d.DataRevision == 0)
        {
            d.DataRevision = 1;
            d.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
    }

    /// <summary>Rename library source and mirror title into linked process GraphJson snapshots.</summary>
    public async Task<(bool ok, string? error, List<int> linkedProcessIds)> UpdateTitleAsync(
        int userId, int id, string? title, CancellationToken ct = default)
    {
        var trimmed = (title ?? "").Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            return (false, "عنوان منبع لازم است.", new List<int>());
        if (trimmed.Length > 200) trimmed = trimmed[..200];

        var entity = await _db.DataSources
            .Include(d => d.ProcessLinks)
            .FirstOrDefaultAsync(d => d.Id == id && d.OwnerUserId == userId, ct);
        if (entity is null) return (false, "notfound", new List<int>());

        entity.Title = trimmed;
        entity.UpdatedAtUtc = DateTime.UtcNow;
        StampDataEditor(entity, userId);
        var processIds = entity.ProcessLinks.Select(l => l.ProcessId).Distinct().ToList();
        await _db.SaveChangesAsync(ct);

        foreach (var pid in processIds)
        {
            try { await PatchSourceTitleInProcessGraphAsync(pid, id, trimmed, ct); }
            catch (Exception ex) { _log.LogWarning(ex, "Patch source title {Ds} on process {P}", id, pid); }
        }
        return (true, null, processIds);
    }

    /// <summary>
    /// Column→node bindings a process node can use to read a library source. The JSON property for
    /// the bound column always sits next to the property holding the source id, so the pair is
    /// declared once here and reused by the dependency scan.
    /// </summary>
    private static readonly (string IdProp, string ColumnProp, string Binding)[] ColumnBindings =
    {
        ("dataSourceId", "dynamicSourceColumnName", "value"),
        ("sourceId", "dynamicSourceColumnName", "value"),
        ("selectorDataSourceId", "selectorDynamicColumn", "selector"),
        ("equalSelectorDataSourceId", "equalSelectorDynamicColumn", "equalSelector"),
        ("attributeDataSourceId", "attributeDynamicColumn", "attribute"),
        ("equalAttributeDataSourceId", "equalAttributeDynamicColumn", "equalAttribute"),
        ("saveDataSourceId", "saveColumnName", "save")
    };

    /// <summary>
    /// Compare an incoming column set against the columns live process nodes currently read.
    ///
    /// Replacing a source's file used to be an all-or-nothing overwrite: dropping a column silently
    /// broke every step bound to it, and the failure only showed up mid-play. This returns the exact
    /// process / node list so the operator can be told before anything is written.
    /// </summary>
    public async Task<ColumnCompatibilityDto?> AnalyzeColumnCompatibilityAsync(
        int userId, int dataSourceId, IReadOnlyList<string> incomingColumnKeys, CancellationToken ct = default)
    {
        var ds = await GetAccessibleAsync(userId, dataSourceId, write: true, ct);
        if (ds is null) return null;

        var current = DeserializeColumns(ds.ColumnsJson);
        return await BuildCompatibilityAsync(ds, current, incomingColumnKeys, ct);
    }

    private async Task<ColumnCompatibilityDto> BuildCompatibilityAsync(
        DataSource ds, List<DataSourceColumnDto> current, IReadOnlyList<string> incomingColumnKeys, CancellationToken ct)
    {
        var incoming = (incomingColumnKeys ?? Array.Empty<string>())
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .Select(k => k.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var incomingSet = new HashSet<string>(incoming, StringComparer.OrdinalIgnoreCase);
        var currentKeys = current.Where(c => !string.IsNullOrWhiteSpace(c.Key)).Select(c => c.Key.Trim()).ToList();

        var dto = new ColumnCompatibilityDto
        {
            DataSourceId = ds.Id,
            DataSourceTitle = ds.Title,
            CurrentColumnKeys = currentKeys,
            IncomingColumnKeys = incoming,
            AddedColumnKeys = incoming.Where(k => !currentKeys.Contains(k, StringComparer.OrdinalIgnoreCase)).ToList()
        };

        // Columns present today but absent from the new file — only these can break a node.
        var dropped = current
            .Where(c => !string.IsNullOrWhiteSpace(c.Key) && !incomingSet.Contains(c.Key.Trim()))
            .ToList();

        var processIds = await _db.ProcessDataSources.AsNoTracking()
            .Where(l => l.DataSourceId == ds.Id)
            .Select(l => l.ProcessId)
            .Distinct()
            .ToListAsync(ct);
        if (processIds.Count == 0) return dto;

        var processes = await _db.Processes.AsNoTracking()
            .Where(p => processIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Title, p.GraphJson })
            .ToListAsync(ct);

        var affectedNodes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var droppedCol in dropped)
        {
            var missing = new MissingColumnDto
            {
                ColumnKey = droppedCol.Key.Trim(),
                ColumnTitle = string.IsNullOrWhiteSpace(droppedCol.Title) ? droppedCol.Key.Trim() : droppedCol.Title.Trim()
            };
            foreach (var p in processes)
            {
                foreach (var hit in FindColumnUsages(p.GraphJson, ds.Id, droppedCol.Key))
                {
                    hit.ProcessId = p.Id;
                    hit.ProcessTitle = p.Title;
                    missing.Nodes.Add(hit);
                    affectedNodes.Add($"{p.Id}:{hit.NodeId}:{hit.Binding}");
                }
            }
            if (missing.Nodes.Count > 0) dto.MissingColumns.Add(missing);
        }
        dto.AffectedNodeCount = affectedNodes.Count;
        return dto;
    }

    /// <summary>
    /// Walk a process graph for nodes bound to <paramref name="dataSourceId"/> whose bound column
    /// equals <paramref name="columnKey"/>. Handles the plain graph and the envelope wrapper.
    /// </summary>
    private static List<ColumnDependencyNodeDto> FindColumnUsages(string? graphJson, int dataSourceId, string columnKey)
    {
        var hits = new List<ColumnDependencyNodeDto>();
        graphJson = GraphJsonHelper.UnwrapEnvelope(graphJson);
        if (string.IsNullOrWhiteSpace(graphJson)) return hits;

        JsonObject? root;
        try { root = JsonNode.Parse(graphJson) as JsonObject; }
        catch { return hits; }
        if (root is null) return hits;

        if (root["nodes"] is not JsonArray nodes) return hits;

        foreach (var n in nodes)
        {
            if (n is not JsonObject no) continue;

            var nodeId = ReadString(no, "id") ?? ReadString(no, "Id") ?? "";
            var kind = ReadString(no, "kind") ?? ReadString(no, "Kind") ?? "";
            var nodeTitle = ReadString(no, "title") ?? ReadString(no, "Title") ?? "";

            foreach (var (idProp, columnProp, binding) in ColumnBindings)
            {
                if (no[idProp]?.GetValue<int?>() != dataSourceId) continue;
                var bound = ReadString(no, columnProp);
                if (string.IsNullOrWhiteSpace(bound)) continue;
                if (!string.Equals(bound.Trim(), columnKey.Trim(), StringComparison.OrdinalIgnoreCase)) continue;
                if (hits.Any(h => h.NodeId == nodeId && h.Binding == binding)) continue;

                hits.Add(new ColumnDependencyNodeDto
                {
                    NodeId = nodeId,
                    Kind = kind,
                    NodeTitle = string.IsNullOrWhiteSpace(nodeTitle) ? nodeId : nodeTitle,
                    Binding = binding
                });
            }
        }
        return hits;
    }

    private static string? ReadString(JsonObject obj, string prop)
    {
        var node = obj[prop];
        if (node is null) return null;
        try { return node.GetValue<string>(); }
        catch { return node.ToJsonString()?.Trim('"'); }
    }

    /// <summary>
    /// Push a new file's content over an existing library source, keeping its id, title and links.
    ///
    /// A column that live nodes still read is refused unless <paramref name="req"/>.Force is set, so
    /// an accidental column rename in Excel cannot quietly break a working process.
    /// </summary>
    public async Task<ReloadDataSourceResponse> ReloadContentAsync(
        int userId, int id, ReloadDataSourceRequest req, CancellationToken ct = default)
    {
        var entity = await _db.DataSources
            .Include(d => d.ProcessLinks)
            .FirstOrDefaultAsync(d => d.Id == id, ct);
        if (entity is null)
            return new ReloadDataSourceResponse { Ok = false, Code = "notfound", Message = "منبع پیدا نشد." };
        if (await GetAccessibleAsync(userId, id, write: true, ct) is null)
            return new ReloadDataSourceResponse { Ok = false, Code = "forbidden", Message = "دسترسی به این منبع ندارید." };

        var columns = NormalizeColumns(req.Columns, req.ColumnKeys);
        if (columns.Count == 0)
            return new ReloadDataSourceResponse
            {
                Ok = false,
                Code = "invalid",
                Message = "فایل اکسل ستون معتبری ندارد (ردیف اول باید هدر باشد)."
            };

        var current = DeserializeColumns(entity.ColumnsJson);
        var compatibility = await BuildCompatibilityAsync(
            entity, current, columns.Select(c => c.Key).ToList(), ct);
        if (compatibility.HasBlockingMissingColumns && !req.Force)
        {
            return new ReloadDataSourceResponse
            {
                Ok = false,
                Code = "blocked-missing-columns",
                Message = "برخی ستون‌ها حذف شده‌اند ولی گره‌هایی از فرآیند به آن‌ها وابسته‌اند.",
                DataSourceId = entity.Id,
                DataSourceTitle = entity.Title,
                Compatibility = compatibility
            };
        }

        var cells = req.Cells ?? new List<DataSourceCellDto>();
        // Cells for columns that no longer exist would be invisible but still counted, so drop them.
        var columnSet = new HashSet<string>(columns.Select(c => c.Key.Trim()), StringComparer.OrdinalIgnoreCase);
        cells = cells
            .Where(c => !string.IsNullOrWhiteSpace(c.Key) && columnSet.Contains(c.Key.Trim()))
            .ToList();
        var rowCount = req.RowCount ?? (cells.Count == 0 ? 0 : cells.Max(c => c.Index) + 1);

        entity.FileName = Trunc(req.FileName, 260) ?? entity.FileName;
        entity.ColumnCount = req.ColumnCount ?? columns.Count;
        entity.RowCount = rowCount;
        entity.ColumnsJson = JsonSerializer.Serialize(columns, JsonOpts);
        entity.CellsJson = JsonSerializer.Serialize(cells, JsonOpts);
        entity.DataRevision += 1;
        entity.UpdatedAtUtc = DateTime.UtcNow;
        StampDataEditor(entity, userId);
        await _db.SaveChangesAsync(ct);

        await ReplaceAllCellsAsync(entity.Id, cells, ct);

        var processIds = entity.ProcessLinks.Select(l => l.ProcessId).Distinct().ToList();
        foreach (var pid in processIds)
        {
            try { await RefreshSourceSnapshotInProcessGraphAsync(pid, entity, ct); }
            catch (Exception ex) { _log.LogWarning(ex, "Refresh source {Ds} snapshot on process {P}", id, pid); }
        }

        return new ReloadDataSourceResponse
        {
            Ok = true,
            DataSourceId = entity.Id,
            DataSourceTitle = entity.Title,
            ColumnCount = entity.ColumnCount,
            RowCount = entity.RowCount,
            ColumnKeys = columns.Select(c => c.Key).ToList(),
            DataRevision = entity.DataRevision,
            Compatibility = compatibility
        };
    }

    /// <summary>
    /// Re-stamp the linked process graphs with this source's new shape (columnKeys/columns/rowCount)
    /// so an open editor does not keep offering columns the source no longer has.
    /// </summary>
    private async Task RefreshSourceSnapshotInProcessGraphAsync(int processId, DataSource ds, CancellationToken ct)
    {
        var process = await _db.Processes.FirstOrDefaultAsync(p => p.Id == processId, ct);
        if (process is null || string.IsNullOrWhiteSpace(process.GraphJson)) return;

        // Stored graphs come in two shapes: a plain graph, or an envelope whose real body lives in a
        // "graphJson" string. Unwrap first — reading dataSources off the envelope root finds an empty
        // array and silently patches nothing.
        var envelope = GraphJsonHelper.TryParseEnvelope(process.GraphJson, out var bodyText);
        var bodyJson = envelope is null ? process.GraphJson : bodyText;

        JsonObject? body;
        try { body = JsonNode.Parse(bodyJson) as JsonObject; }
        catch { return; }
        if (body is null) return;
        if (body["dataSources"] is not JsonArray arr) return;

        var changed = false;
        for (var i = 0; i < arr.Count; i++)
        {
            if (arr[i] is not JsonObject o) continue;
            var sid = o["id"]?.GetValue<int?>() ?? o["Id"]?.GetValue<int?>();
            if (sid != ds.Id) continue;
            arr[i] = ToGraphNode(ds);
            changed = true;
        }
        if (!changed) return;

        process.GraphJson = envelope is null
            ? body.ToJsonString(JsonOpts)
            : EnvelopeWithBody(envelope, body).ToJsonString(JsonOpts);
        process.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private static JsonObject EnvelopeWithBody(JsonObject envelope, JsonObject body)
    {
        envelope["graphJson"] = body.ToJsonString(JsonOpts);
        // The envelope mirrors the body's source list for list views; keep the two in step.
        if (body["dataSources"] is JsonArray sources)
            envelope["dataSources"] = JsonNode.Parse(sources.ToJsonString())!.AsArray();
        return envelope;
    }

    /// <summary>
    /// Append (or insert) a column on a library source.
    ///
    /// Adding a column is harmless to running processes — nothing binds to it yet — so unlike a
    /// reload this needs no compatibility check. The key must stay unique inside the source because
    /// nodes bind to it by name.
    /// </summary>
    public async Task<DataSourceStructureResponse> AddColumnAsync(
        int userId, int id, AddDataSourceColumnRequest req, CancellationToken ct = default)
    {
        var entity = await GetAccessibleAsync(userId, id, write: true, ct);
        if (entity is null)
            return new DataSourceStructureResponse { Ok = false, Code = "forbidden", Message = "دسترسی به این منبع ندارید." };

        var columns = DeserializeColumns(entity.ColumnsJson);
        var existing = new HashSet<string>(columns.Select(c => c.Key), StringComparer.OrdinalIgnoreCase);

        var key = (req.Key ?? "").Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            // Generate c1, c2, … skipping any key already in use.
            var n = columns.Count + 1;
            do { key = $"c{n++}"; } while (existing.Contains(key));
        }
        if (existing.Contains(key))
            return new DataSourceStructureResponse
            {
                Ok = false,
                Code = "duplicate-key",
                Message = $"ستونی با کلید «{key}» از قبل وجود دارد.",
                DataSourceId = id,
                Columns = columns,
                ColumnKeys = columns.Select(c => c.Key).ToList()
            };

        var title = string.IsNullOrWhiteSpace(req.Title) ? key : req.Title.Trim();
        var column = new DataSourceColumnDto { Key = key, Title = title };
        var at = req.BeforeIndex ?? columns.Count;
        if (at < 0) at = 0;
        if (at > columns.Count) at = columns.Count;
        columns.Insert(at, column);

        entity.ColumnsJson = JsonSerializer.Serialize(columns, JsonOpts);
        entity.ColumnCount = columns.Count;
        // A new column has no cells yet, so the row count is unchanged; keep it truthful.
        entity.DataRevision += 1;
        entity.UpdatedAtUtc = DateTime.UtcNow;
        StampDataEditor(entity, userId);
        await _db.SaveChangesAsync(ct);

        var (_, rc) = await GetDerivedCountersAsync(id, ct);
        var rowCount = Math.Max(entity.RowCount, rc);
        await RefreshLinkedProcessSnapshotsAsync(entity, ct);
        return new DataSourceStructureResponse
        {
            Ok = true,
            DataSourceId = entity.Id,
            Columns = columns,
            ColumnKeys = columns.Select(c => c.Key).ToList(),
            ColumnCount = columns.Count,
            RowCount = rowCount,
            DataRevision = entity.DataRevision,
            AddedColumnKey = key
        };
    }

    /// <summary>
    /// Insert blank rows into a library source. Blank rows are materialised as empty cells so the
    /// normal row-page query returns them (it drives row count from the cell table, not the parent).
    /// </summary>
    public async Task<DataSourceStructureResponse> AddRowsAsync(
        int userId, int id, AddDataSourceRowRequest req, CancellationToken ct = default)
    {
        var entity = await GetAccessibleAsync(userId, id, write: true, ct);
        if (entity is null)
            return new DataSourceStructureResponse { Ok = false, Code = "forbidden", Message = "دسترسی به این منبع ندارید." };

        var columns = DeserializeColumns(entity.ColumnsJson);
        if (columns.Count == 0)
            return new DataSourceStructureResponse
            {
                Ok = false, Code = "no-columns", Message = "منبع ستونی ندارد؛ اول یک ستون اضافه کنید."
            };

        var add = Math.Clamp(req.Count ?? 1, 1, 500);
        var (_, rowCount) = await GetDerivedCountersAsync(id, ct);
        rowCount = Math.Max(rowCount, entity.RowCount);

        // Build the cell rows first, then shift existing rows down when inserting in the middle.
        var at = req.BeforeIndex ?? rowCount;
        if (at < 0) at = 0;
        if (at > rowCount) at = rowCount;

        var existing = await _db.DataSourceCells.Where(c => c.DataSourceId == id).ToListAsync(ct);
        if (at < rowCount)
        {
            // Shift down from the end so no two rows collide on the (DataSourceId, RowIndex, ColumnKey) key.
            foreach (var cell in existing.OrderByDescending(c => c.RowIndex))
            {
                if (cell.RowIndex >= at) cell.RowIndex += add;
            }
        }
        for (var r = 0; r < add; r++)
        {
            foreach (var col in columns)
            {
                _db.DataSourceCells.Add(new DataSourceCell
                {
                    DataSourceId = id,
                    RowIndex = at + r,
                    ColumnKey = col.Key,
                    CellValue = ""
                });
            }
        }

        entity.RowCount = rowCount + add;
        entity.DataRevision += 1;
        entity.UpdatedAtUtc = DateTime.UtcNow;
        StampDataEditor(entity, userId);
        await _db.SaveChangesAsync(ct);

        await RefreshLinkedProcessSnapshotsAsync(entity, ct);
        return new DataSourceStructureResponse
        {
            Ok = true,
            DataSourceId = entity.Id,
            Columns = columns,
            ColumnKeys = columns.Select(c => c.Key).ToList(),
            ColumnCount = columns.Count,
            RowCount = entity.RowCount,
            DataRevision = entity.DataRevision
        };
    }

    /// <summary>Re-stamp every linked process graph with this source's current shape.</summary>
    private async Task RefreshLinkedProcessSnapshotsAsync(DataSource entity, CancellationToken ct)
    {
        var processIds = await _db.ProcessDataSources.AsNoTracking()
            .Where(l => l.DataSourceId == entity.Id)
            .Select(l => l.ProcessId)
            .Distinct()
            .ToListAsync(ct);
        foreach (var pid in processIds)
        {
            try { await RefreshSourceSnapshotInProcessGraphAsync(pid, entity, ct); }
            catch (Exception ex) { _log.LogWarning(ex, "Refresh source {Ds} snapshot on process {P}", entity.Id, pid); }
        }
    }

    public async Task<bool> DeleteLibraryAsync(int userId, int id, CancellationToken ct = default)
    {
        var entity = await _db.DataSources
            .Include(d => d.ProcessLinks)
            .FirstOrDefaultAsync(d => d.Id == id && d.OwnerUserId == userId, ct);
        if (entity is null) return false;

        var processIds = entity.ProcessLinks.Select(l => l.ProcessId).Distinct().ToList();
        _db.ProcessDataSources.RemoveRange(entity.ProcessLinks);
        _db.DataSources.Remove(entity);
        await _db.SaveChangesAsync(ct);

        // Scrub snapshot from linked process graphs (keep selector column names on nodes).
        foreach (var pid in processIds)
        {
            try { await ScrubSourceFromProcessGraphAsync(pid, id, ct); }
            catch (Exception ex) { _log.LogWarning(ex, "Scrub source {Ds} from process {P}", id, pid); }
        }
        return true;
    }

    public async Task<(bool ok, string? error)> AttachAsync(
        int userId, int processId, int dataSourceId, bool setDefault = false, CancellationToken ct = default)
    {
        var process = await _db.Processes.Include(p => p.DataSourceLinks)
            .FirstOrDefaultAsync(p => p.Id == processId, ct);
        if (process is null) return (false, "notfound");

        var canChange = await _db.ProcessShares.AnyAsync(a =>
            a.UserId == userId && a.ProcessId == processId
            && (a.CanChangeDataSource || a.CanEdit || a.Process.CreatorUserId == userId), ct);
        if (!canChange) return (false, "forbidden");

        var ds = await _db.DataSources.FirstOrDefaultAsync(d => d.Id == dataSourceId, ct);
        if (ds is null) return (false, "sourcenotfound");
        // Owner or already shared via another process of this user — require owner for attach from library
        if (ds.OwnerUserId != userId && process.CreatorUserId != userId
            && ds.OwnerUserId != process.CreatorUserId)
            return (false, "forbidden");

        if (process.DataSourceLinks.Any(l => l.DataSourceId == dataSourceId))
        {
            if (setDefault)
            {
                foreach (var l in process.DataSourceLinks) l.IsDefault = l.DataSourceId == dataSourceId;
                await _db.SaveChangesAsync(ct);
                // Do not patch GraphJson / UpdatedAtUtc here — open editors own concurrency via PUT /canvas.
            }
            return (true, null);
        }

        var sort = process.DataSourceLinks.Count == 0 ? 0 : process.DataSourceLinks.Max(l => l.SortOrder) + 1;
        var makeDefault = setDefault || process.DataSourceLinks.Count == 0;
        if (makeDefault)
            foreach (var l in process.DataSourceLinks) l.IsDefault = false;

        process.DataSourceLinks.Add(new ProcessDataSource
        {
            ProcessId = processId,
            DataSourceId = dataSourceId,
            IsDefault = makeDefault,
            SortOrder = sort
        });
        await _db.SaveChangesAsync(ct);
        // Graph snapshot is written by the editor canvas save (SyncFromCanvas).
        return (true, null);
    }

    public async Task<(bool ok, string? error)> DetachAsync(
        int userId, int processId, int dataSourceId, CancellationToken ct = default)
    {
        var canChange = await _db.ProcessShares.AnyAsync(a =>
            a.UserId == userId && a.ProcessId == processId
            && (a.CanChangeDataSource || a.CanEdit || a.Process.CreatorUserId == userId), ct);
        if (!canChange) return (false, "forbidden");

        var link = await _db.ProcessDataSources
            .FirstOrDefaultAsync(l => l.ProcessId == processId && l.DataSourceId == dataSourceId, ct);
        if (link is null)
            return (true, null);

        var wasDefault = link.IsDefault;
        _db.ProcessDataSources.Remove(link);
        await _db.SaveChangesAsync(ct);

        if (wasDefault)
        {
            var next = await _db.ProcessDataSources
                .Where(l => l.ProcessId == processId)
                .OrderBy(l => l.SortOrder)
                .FirstOrDefaultAsync(ct);
            if (next != null)
            {
                next.IsDefault = true;
                await _db.SaveChangesAsync(ct);
            }
        }

        // Do not mutate GraphJson / UpdatedAtUtc — editor save owns the canvas document.
        return (true, null);
    }

    /// <summary>
    /// On canvas save: upsert library rows for embedded sources, sync process links.
    /// Detached library rows are never deleted. Returns possibly remapped GraphJson.
    /// </summary>
    public async Task<string> SyncFromCanvasAsync(
        Process process, string canvasJson, int actingUserId, CancellationToken ct = default)
    {
        JsonNode? root;
        try { root = JsonNode.Parse(canvasJson); }
        catch { return canvasJson; }
        if (root is not JsonObject obj) return canvasJson;

        var arr = obj["dataSources"] as JsonArray ?? obj["DataSources"] as JsonArray;
        if (arr is null)
        {
            arr = new JsonArray();
            obj["dataSources"] = arr;
        }

        var ownerId = process.CreatorUserId ?? actingUserId;
        var links = await _db.ProcessDataSources
            .Where(l => l.ProcessId == process.Id)
            .ToListAsync(ct);
        var keepIds = new HashSet<int>();
        var masterId = ReadMasterId(obj);
        var order = 0;

        foreach (var node in arr.ToList())
        {
            if (node is not JsonObject dsObj) continue;
            var parsed = ParseEmbedded(dsObj);
            if (parsed.columns.Count == 0 && parsed.cells.Count == 0 && string.IsNullOrWhiteSpace(parsed.title))
                continue;

            DataSource? entity = null;
            if (parsed.id is int existingId && existingId > 0)
                entity = await _db.DataSources.FirstOrDefaultAsync(d => d.Id == existingId, ct);

            if (entity is null)
            {
                entity = new DataSource
                {
                    OwnerUserId = ownerId,
                    Title = Trunc(parsed.title, 200) ?? $"منبع {DateTime.UtcNow:yyyy-MM-dd}",
                    FileName = Trunc(parsed.fileName, 260),
                    ColumnCount = parsed.columnCount,
                    RowCount = parsed.rowCount,
                    ColumnsJson = JsonSerializer.Serialize(parsed.columns, JsonOpts),
                    CellsJson = JsonSerializer.Serialize(parsed.cells, JsonOpts),
                    CreatedAtUtc = DateTime.UtcNow,
                    UpdatedAtUtc = DateTime.UtcNow
                };
                _db.DataSources.Add(entity);
                await _db.SaveChangesAsync(ct);
                await ReplaceAllCellsAsync(entity.Id, parsed.cells, ct);
                entity.DataRevision = 1;
                entity.CellsJson = JsonSerializer.Serialize(parsed.cells, JsonOpts);
                await _db.SaveChangesAsync(ct);
                dsObj["id"] = entity.Id;
            }
            else if (entity.OwnerUserId == ownerId || entity.OwnerUserId == actingUserId)
            {
                entity.Title = Trunc(parsed.title, 200) ?? entity.Title;
                entity.FileName = Trunc(parsed.fileName, 260) ?? entity.FileName;
                entity.ColumnCount = parsed.columnCount;
                // Cells live in DataSourceCells — never replace entire grid from canvas snapshot (concurrency).
                if (parsed.columns.Count > 0)
                {
                    entity.ColumnsJson = JsonSerializer.Serialize(parsed.columns, JsonOpts);
                    entity.ColumnCount = parsed.columns.Count;
                }
                if (parsed.rowCount > entity.RowCount)
                    entity.RowCount = parsed.rowCount;
                entity.UpdatedAtUtc = DateTime.UtcNow;
                StampDataEditor(entity, actingUserId);
                dsObj["id"] = entity.Id;
            }

            keepIds.Add(entity.Id);
            var link = links.FirstOrDefault(l => l.DataSourceId == entity.Id);
            if (link is null)
            {
                link = new ProcessDataSource
                {
                    ProcessId = process.Id,
                    DataSourceId = entity.Id,
                    SortOrder = order
                };
                _db.ProcessDataSources.Add(link);
                links.Add(link);
            }
            link.SortOrder = order++;
            link.IsDefault = masterId is int mid && mid == entity.Id;
        }

        // If no master flagged, first link is default
        if (!links.Any(l => keepIds.Contains(l.DataSourceId) && l.IsDefault) && keepIds.Count > 0)
        {
            var first = links.Where(l => keepIds.Contains(l.DataSourceId)).OrderBy(l => l.SortOrder).First();
            first.IsDefault = true;
            obj["dataSourceId"] = first.DataSourceId;
            if (obj["nodes"] is JsonArray nodes)
            {
                foreach (var n in nodes)
                {
                    if (n is JsonObject no && string.Equals(no["kind"]?.GetValue<string>(), "start", StringComparison.OrdinalIgnoreCase))
                    {
                        no["dataSourceId"] = first.DataSourceId;
                        break;
                    }
                }
            }
        }

        foreach (var orphan in links.Where(l => !keepIds.Contains(l.DataSourceId)).ToList())
            _db.ProcessDataSources.Remove(orphan);

        await _db.SaveChangesAsync(ct);
        return obj.ToJsonString(JsonOpts);
    }

    /// <summary>Hydrate process graph dataSources from library links (fallback to embedded).</summary>
    public async Task<string?> HydrateCanvasAsync(int processId, string? graphJson, CancellationToken ct = default)
    {
        graphJson = GraphJsonHelper.UnwrapEnvelope(graphJson);

        var links = await _db.ProcessDataSources.AsNoTracking()
            .Where(l => l.ProcessId == processId)
            .OrderBy(l => l.SortOrder)
            .Include(l => l.DataSource)
            .ToListAsync(ct);

        if (links.Count == 0)
        {
            // Lazy extract: if graph has embedded sources, leave as-is (SyncFromCanvas on next save).
            return graphJson;
        }

        JsonObject obj;
        try
        {
            obj = string.IsNullOrWhiteSpace(graphJson)
                ? new JsonObject()
                : (JsonNode.Parse(graphJson) as JsonObject) ?? new JsonObject();
        }
        catch
        {
            obj = new JsonObject();
        }

        var arr = new JsonArray();
        int? defaultId = null;
        foreach (var link in links)
        {
            if (link.DataSource is null) continue;
            if (link.IsDefault) defaultId = link.DataSourceId;
            arr.Add(ToGraphNode(link.DataSource));
        }
        obj["dataSources"] = arr;
        if (defaultId is int did)
        {
            obj["dataSourceId"] = did;
            if (obj["nodes"] is JsonArray nodes)
            {
                foreach (var n in nodes)
                {
                    if (n is JsonObject no &&
                        string.Equals(no["kind"]?.GetValue<string>(), "start", StringComparison.OrdinalIgnoreCase))
                    {
                        no["dataSourceId"] = did;
                        break;
                    }
                }
            }
        }
        return obj.ToJsonString(JsonOpts);
    }

    private async Task EnsureGraphHasSourceSnapshotAsync(int processId, DataSource ds, bool makeDefault, CancellationToken ct)
    {
        var process = await _db.Processes.FirstOrDefaultAsync(p => p.Id == processId, ct);
        if (process is null) return;
        JsonObject obj;
        try
        {
            obj = string.IsNullOrWhiteSpace(process.GraphJson)
                ? new JsonObject { ["nodes"] = new JsonArray(), ["edges"] = new JsonArray() }
                : (JsonNode.Parse(process.GraphJson) as JsonObject)
                  ?? new JsonObject { ["nodes"] = new JsonArray(), ["edges"] = new JsonArray() };
        }
        catch
        {
            obj = new JsonObject { ["nodes"] = new JsonArray(), ["edges"] = new JsonArray() };
        }

        var arr = obj["dataSources"] as JsonArray ?? new JsonArray();
        obj["dataSources"] = arr;
        var exists = false;
        foreach (var n in arr)
        {
            if (n is JsonObject o && o["id"]?.GetValue<int?>() == ds.Id) { exists = true; break; }
        }
        if (!exists) arr.Add(ToGraphNode(ds));
        if (makeDefault) ApplyMaster(obj, ds.Id);
        process.GraphJson = obj.ToJsonString(JsonOpts);
        process.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private async Task PatchSourceTitleInProcessGraphAsync(int processId, int dataSourceId, string title, CancellationToken ct)
    {
        var process = await _db.Processes.FirstOrDefaultAsync(p => p.Id == processId, ct);
        if (process is null || string.IsNullOrWhiteSpace(process.GraphJson)) return;
        JsonObject? obj;
        try { obj = JsonNode.Parse(process.GraphJson) as JsonObject; }
        catch { return; }
        if (obj is null) return;

        var changed = false;
        if (obj["dataSources"] is JsonArray arr)
        {
            foreach (var item in arr)
            {
                if (item is not JsonObject o) continue;
                var sid = o["id"]?.GetValue<int?>() ?? o["Id"]?.GetValue<int?>();
                if (sid != dataSourceId) continue;
                o["title"] = title;
                changed = true;
            }
        }
        if (!changed) return;
        process.GraphJson = obj.ToJsonString(JsonOpts);
        process.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private async Task ScrubSourceFromProcessGraphAsync(int processId, int dataSourceId, CancellationToken ct)
    {
        var process = await _db.Processes.FirstOrDefaultAsync(p => p.Id == processId, ct);
        if (process is null || string.IsNullOrWhiteSpace(process.GraphJson)) return;
        JsonObject? obj;
        try { obj = JsonNode.Parse(process.GraphJson) as JsonObject; }
        catch { return; }
        if (obj is null) return;

        if (obj["dataSources"] is JsonArray arr)
        {
            for (var i = arr.Count - 1; i >= 0; i--)
            {
                if (arr[i] is JsonObject o && o["id"]?.GetValue<int?>() == dataSourceId)
                    arr.RemoveAt(i);
            }
        }
        // Clear DS id refs on nodes — keep column name fields.
        if (obj["nodes"] is JsonArray nodes)
        {
            foreach (var n in nodes)
            {
                if (n is not JsonObject no) continue;
                ClearIdIfMatch(no, "dataSourceId", dataSourceId);
                ClearIdIfMatch(no, "sourceId", dataSourceId);
                ClearIdIfMatch(no, "selectorDataSourceId", dataSourceId);
                ClearIdIfMatch(no, "equalSelectorDataSourceId", dataSourceId);
                ClearIdIfMatch(no, "attributeDataSourceId", dataSourceId);
                ClearIdIfMatch(no, "equalAttributeDataSourceId", dataSourceId);
                ClearIdIfMatch(no, "saveDataSourceId", dataSourceId);
            }
        }
        if (obj["dataSourceId"]?.GetValue<int?>() == dataSourceId)
            obj.Remove("dataSourceId");

        process.GraphJson = obj.ToJsonString(JsonOpts);
        process.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private async Task PatchMasterInGraphAsync(int processId, int? dataSourceId, CancellationToken ct)
    {
        var process = await _db.Processes.FirstOrDefaultAsync(p => p.Id == processId, ct);
        if (process is null || string.IsNullOrWhiteSpace(process.GraphJson)) return;
        JsonObject? obj;
        try { obj = JsonNode.Parse(process.GraphJson) as JsonObject; }
        catch { return; }
        if (obj is null) return;
        ApplyMaster(obj, dataSourceId);
        process.GraphJson = obj.ToJsonString(JsonOpts);
        process.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private static void ApplyMaster(JsonObject obj, int? dataSourceId)
    {
        if (dataSourceId is int id)
            obj["dataSourceId"] = id;
        else
            obj.Remove("dataSourceId");
        if (obj["nodes"] is not JsonArray nodes) return;
        foreach (var n in nodes)
        {
            if (n is JsonObject no &&
                string.Equals(no["kind"]?.GetValue<string>(), "start", StringComparison.OrdinalIgnoreCase))
            {
                if (dataSourceId is int mid) no["dataSourceId"] = mid;
                else no.Remove("dataSourceId");
                break;
            }
        }
    }

    private static void ClearIdIfMatch(JsonObject no, string prop, int id)
    {
        if (no[prop]?.GetValue<int?>() == id)
            no[prop] = null;
    }

    private async Task<EntitlementsDto> ResolveEntitlements(int userId, CancellationToken ct)
    {
        var dbUser = await _db.Users.AsNoTracking().Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct);
        return dbUser is null
            ? EntitlementService.LocalDefaults()
            : await _entitlements.ResolveForUserAsync(dbUser, ct);
    }

    private static JsonObject ToGraphNode(DataSource d)
    {
        var cols = DeserializeColumns(d.ColumnsJson);
        return new JsonObject
        {
            ["id"] = d.Id,
            ["title"] = d.Title,
            ["fileName"] = d.FileName,
            ["columnCount"] = d.ColumnCount,
            ["rowCount"] = d.RowCount,
            ["dataRevision"] = d.DataRevision,
            ["columnKeys"] = new JsonArray(cols.Select(c => (JsonNode?)JsonValue.Create(c.Key)).ToArray()),
            ["columns"] = JsonNode.Parse(JsonSerializer.Serialize(cols, JsonOpts))!.AsArray()
            // cells omitted — load via /api/datasources/{id}/cells or /rows
        };
    }

    private static DataSourceMetaDto ToMeta(DataSource d)
        => ToMeta(d, null);

    /// <summary>
    /// Builds meta from the cell table when available, falling back to the stored columns.
    /// Cell writes no longer touch the parent row, so RowCount/DataRevision must be derived
    /// here instead of read from stale DataSource columns.
    /// </summary>
    public async Task<DataSourceMetaDto?> GetMetaDerivedAsync(int userId, int id, CancellationToken ct = default)
    {
        var d = await GetAccessibleAsync(userId, id, write: false, ct);
        if (d is null) return null;
        var (dataRevision, rowCount) = await GetDerivedCountersAsync(id, ct);
        if (dataRevision == 0) dataRevision = d.DataRevision;
        if (rowCount < d.RowCount) rowCount = d.RowCount;
        return ToMeta(d, dataRevision, rowCount);
    }

    private static DataSourceMetaDto ToMeta(DataSource d, long? dataRevision, int? rowCount = null)
    {
        var cols = DeserializeColumns(d.ColumnsJson);
        return new DataSourceMetaDto
        {
            Id = d.Id,
            Title = d.Title,
            FileName = d.FileName,
            Columns = cols,
            ColumnKeys = cols.Select(c => c.Key).ToList(),
            ColumnCount = d.ColumnCount,
            RowCount = Math.Max(rowCount ?? 0, d.RowCount),
            DataRevision = dataRevision ?? d.DataRevision
        };
    }

    private static DataSourceDetailDto ToDetail(DataSource d, List<DataSourceCellDto>? cells = null)
    {
        var cols = DeserializeColumns(d.ColumnsJson);
        cells ??= DeserializeCells(d.CellsJson);
        return new DataSourceDetailDto
        {
            Id = d.Id,
            Title = d.Title,
            FileName = d.FileName,
            Columns = cols,
            ColumnKeys = cols.Select(c => c.Key).ToList(),
            Cells = cells,
            ColumnCount = d.ColumnCount,
            RowCount = d.RowCount,
            DataRevision = d.DataRevision
        };
    }

    private static UploadDataSourceResponse ToUploadResponse(
        DataSource d, List<DataSourceColumnDto> cols, List<DataSourceCellDto> cells) => new()
    {
        Id = d.Id,
        Title = d.Title,
        FileName = d.FileName,
        ColumnCount = d.ColumnCount,
        RowCount = d.RowCount,
        Columns = cols,
        ColumnKeys = cols.Select(c => c.Key).ToList(),
        Cells = cells
    };

    private static List<DataSourceColumnDto> NormalizeColumns(
        List<DataSourceColumnDto>? columns, List<string>? keys)
    {
        if (columns is { Count: > 0 })
            return columns.Where(c => !string.IsNullOrWhiteSpace(c.Key))
                .Select(c => new DataSourceColumnDto
                {
                    Key = c.Key.Trim(),
                    Title = string.IsNullOrWhiteSpace(c.Title) ? c.Key.Trim() : c.Title.Trim()
                }).ToList();
        return (keys ?? new List<string>())
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .Select(k => new DataSourceColumnDto { Key = k.Trim(), Title = k.Trim() })
            .ToList();
    }

    private static List<DataSourceColumnDto> DeserializeColumns(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<List<DataSourceColumnDto>>(json, JsonOpts) ?? new(); }
        catch { return new(); }
    }

    private static List<DataSourceCellDto> DeserializeCells(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<List<DataSourceCellDto>>(json, JsonOpts) ?? new(); }
        catch { return new(); }
    }

    private static int? ReadMasterId(JsonObject obj)
    {
        if (obj["dataSourceId"] is JsonValue v && v.TryGetValue<int>(out var id)) return id;
        if (obj["nodes"] is JsonArray nodes)
        {
            foreach (var n in nodes)
            {
                if (n is JsonObject no &&
                    string.Equals(no["kind"]?.GetValue<string>(), "start", StringComparison.OrdinalIgnoreCase)
                    && no["dataSourceId"] is JsonValue sv && sv.TryGetValue<int>(out var sid))
                    return sid;
            }
        }
        return null;
    }

    private static (int? id, string? title, string? fileName, int columnCount, int rowCount,
        List<DataSourceColumnDto> columns, List<DataSourceCellDto> cells) ParseEmbedded(JsonObject dsObj)
    {
        int? id = null;
        if (dsObj["id"] is JsonValue idv)
        {
            if (idv.TryGetValue<int>(out var i)) id = i;
            else if (int.TryParse(idv.ToString(), out var i2)) id = i2;
        }
        var title = dsObj["title"]?.GetValue<string>() ?? dsObj["Title"]?.GetValue<string>();
        var fileName = dsObj["fileName"]?.GetValue<string>() ?? dsObj["FileName"]?.GetValue<string>();
        var columns = new List<DataSourceColumnDto>();
        if (dsObj["columns"] is JsonArray colsArr)
        {
            foreach (var c in colsArr)
            {
                if (c is not JsonObject co) continue;
                var key = co["key"]?.GetValue<string>() ?? co["Key"]?.GetValue<string>() ?? "";
                if (string.IsNullOrWhiteSpace(key)) continue;
                columns.Add(new DataSourceColumnDto
                {
                    Key = key,
                    Title = co["title"]?.GetValue<string>() ?? co["Title"]?.GetValue<string>() ?? key
                });
            }
        }
        if (columns.Count == 0 && dsObj["columnKeys"] is JsonArray keys)
        {
            foreach (var k in keys)
            {
                var key = k?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(key)) continue;
                columns.Add(new DataSourceColumnDto { Key = key, Title = key });
            }
        }
        var cells = new List<DataSourceCellDto>();
        if (dsObj["cells"] is JsonArray cellsArr)
        {
            foreach (var c in cellsArr)
            {
                if (c is not JsonObject co) continue;
                cells.Add(new DataSourceCellDto
                {
                    Key = co["key"]?.GetValue<string>() ?? co["Key"]?.GetValue<string>() ?? "",
                    Index = co["index"]?.GetValue<int?>() ?? co["Index"]?.GetValue<int?>() ?? 0,
                    CellValue = co["cellValue"]?.GetValue<string>() ?? co["CellValue"]?.GetValue<string>() ?? ""
                });
            }
        }
        var columnCount = dsObj["columnCount"]?.GetValue<int?>() ?? columns.Count;
        var rowCount = dsObj["rowCount"]?.GetValue<int?>()
                       ?? (cells.Count == 0 ? 0 : cells.Max(x => x.Index) + 1);
        return (id, title, fileName, columnCount, rowCount, columns, cells);
    }

    private static string? Trunc(string? s, int max)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        return s.Length <= max ? s : s[..max];
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

public class AdminLibrarySourceRow
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string OwnerUserName { get; set; } = "";
    public string? LastEditorUserName { get; set; }
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public string? FileName { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public int LinkedProcessCount { get; set; }
    public string LinkedProcessTitles { get; set; } = "";
}
