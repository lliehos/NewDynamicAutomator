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
                d.ColumnCount,
                d.RowCount,
                d.FileName,
                LinkedProcessCount = d.ProcessLinks.Count,
                Titles = d.ProcessLinks.Select(l => l.Process != null ? l.Process.Title : "?").ToList()
            })
            .ToListAsync(ct);

        return rows.Select(d => new AdminLibrarySourceRow
        {
            Id = d.Id,
            Title = d.Title,
            OwnerUserName = d.OwnerUserName,
            ColumnCount = d.ColumnCount,
            RowCount = d.RowCount,
            FileName = d.FileName,
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
            DataRevision = d.DataRevision
        };
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

        for (var attempt = 0; attempt < 30; attempt++)
        {
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
                    expectedRev = locked.CellRevision;
                    await Task.Delay(40 + attempt * 25, ct);
                    continue;
                }

                if (locked is null)
                {
                    var exists = await _db.DataSourceCells.AsNoTracking()
                        .AnyAsync(c => c.DataSourceId == id && c.RowIndex == req.RowIndex && c.ColumnKey == key, ct);
                    if (exists)
                    {
                        await tx.RollbackAsync(ct);
                        await Task.Delay(40 + attempt * 25, ct);
                        continue;
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

                ds.DataRevision++;
                ds.RowCount = Math.Max(ds.RowCount, req.RowIndex + 1);
                ds.UpdatedAtUtc = DateTime.UtcNow;
                StampDataEditor(ds, userId);
                await _db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);

                return new PatchDataSourceCellResponse
                {
                    Ok = true,
                    DataRevision = ds.DataRevision,
                    CellRevision = locked.CellRevision,
                    CellValue = value
                };
            }
            catch (Exception ex) when (attempt < 29)
            {
                try { await tx.RollbackAsync(ct); } catch { /* ignore */ }
                _log.LogDebug(ex, "PatchCell retry {Attempt} ds={Ds} r={Row} c={Col}", attempt, id, req.RowIndex, key);
                await Task.Delay(50 + attempt * 25, ct);
            }
        }

        return new PatchDataSourceCellResponse
        {
            Ok = false,
            Message = "نوشتن سلول بعد از چند تلاش ممکن نشد — صبر کنید و دوباره اجرا کنید."
        };
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

    async Task EnsureLegacyCellsMaterializedAsync(DataSource d, CancellationToken ct)
    {
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
            RowCount = d.RowCount,
            DataRevision = d.DataRevision
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
    public int ColumnCount { get; set; }
    public int RowCount { get; set; }
    public string? FileName { get; set; }
    public int LinkedProcessCount { get; set; }
    public string LinkedProcessTitles { get; set; } = "";
}
