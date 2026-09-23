using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Morobot.Infrastructure.Services;

public class LegacyUserRow
{
    public int Id { get; set; }
    public string UserName { get; set; } = "";
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public int ProcessCount { get; set; }
}

public class LegacyImportReport
{
    public List<string> Lines { get; } = new();
    public int UsersCreated { get; set; }
    public int UsersMatched { get; set; }
    public int ProcessesImported { get; set; }
    public int ProcessesSkipped { get; set; }
    public int Errors { get; set; }
}

/// <summary>Import processes from a legacy Windows / mid-schema SQL database into Processes.GraphJson.</summary>
public class LegacyImportService
{
    private readonly AppDbContext _db;
    private readonly ILogger<LegacyImportService> _log;
    private readonly PasswordHasher<AppUser> _hasher = new();

    public LegacyImportService(AppDbContext db, ILogger<LegacyImportService> log)
    {
        _db = db;
        _log = log;
    }

    public async Task<(List<LegacyUserRow>? users, string? error)> ListUsersAsync(
        string connectionString, CancellationToken ct = default)
    {
        try
        {
            await using var conn = new SqlConnection(connectionString);
            await conn.OpenAsync(ct);
            if (!await CanvasBackfillService.LegacyTableExistsAsync(conn, "Users", ct))
                return (null, "جدول Users در دیتابیس قدیمی پیدا نشد.");
            if (!await CanvasBackfillService.LegacyTableExistsAsync(conn, "Tasks", ct))
                return (null, "جدول Tasks در دیتابیس قدیمی پیدا نشد.");

            var hasFirst = await ColumnExists(conn, "Users", "FirstName", ct);
            var hasLast = await ColumnExists(conn, "Users", "LastName", ct);
            var hasCreator = await ColumnExists(conn, "Tasks", "CreatorUserId", ct);

            var sql = $@"
SELECT u.Id, u.UserName,
       {(hasFirst ? "u.FirstName" : "CAST(NULL AS nvarchar(50))")},
       {(hasLast ? "u.LastName" : "CAST(NULL AS nvarchar(50))")},
       (
         SELECT COUNT(1) FROM Tasks t WHERE
           {(hasCreator ? "t.CreatorUserId = u.Id" : "1=0")}
       ) AS ProcessCount
FROM Users u
ORDER BY u.UserName";

            var list = new List<LegacyUserRow>();
            await using var cmd = new SqlCommand(sql, conn);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                list.Add(new LegacyUserRow
                {
                    Id = r.GetInt32(0),
                    UserName = r.GetString(1),
                    FirstName = r.IsDBNull(2) ? null : r.GetString(2),
                    LastName = r.IsDBNull(3) ? null : r.GetString(3),
                    ProcessCount = r.IsDBNull(4) ? 0 : Convert.ToInt32(r.GetValue(4))
                });
            }
            return (list, null);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Legacy list users failed");
            return (null, ex.Message);
        }
    }

    public async Task<LegacyImportReport> ImportUsersAsync(
        string connectionString, IReadOnlyList<int> legacyUserIds, CancellationToken ct = default)
    {
        var report = new LegacyImportReport();
        if (legacyUserIds.Count == 0)
        {
            report.Lines.Add("هیچ کاربری انتخاب نشده است.");
            return report;
        }

        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);

        var freePlan = await _db.Plans.FirstOrDefaultAsync(p => p.Code == nameof(PlanCode.Free), ct);
        var hasCreator = await ColumnExists(conn, "Tasks", "CreatorUserId", ct);
        // Only processes this user owns (CreatorUserId) — not shared UserTasks.
        var hasUserTasks = false;

        foreach (var legacyUserId in legacyUserIds.Distinct())
        {
            try
            {
                await ImportOneUserAsync(conn, legacyUserId, freePlan, hasCreator, hasUserTasks, report, ct);
            }
            catch (Exception ex)
            {
                report.Errors++;
                report.Lines.Add($"خطا برای کاربر #{legacyUserId}: {ex.Message}");
                _log.LogError(ex, "Import user {Id}", legacyUserId);
            }
        }

        return report;
    }

    private async Task ImportOneUserAsync(
        SqlConnection conn, int legacyUserId, Plan? freePlan,
        bool hasCreator, bool hasUserTasks, LegacyImportReport report, CancellationToken ct)
    {
        string userName;
        string? first = null, last = null, email = null;
        await using (var cmd = new SqlCommand(
                         "SELECT UserName, FirstName, LastName, Email FROM Users WHERE Id=@id", conn))
        {
            // Columns may not all exist — fall back
            cmd.CommandText = "SELECT UserName FROM Users WHERE Id=@id";
            cmd.Parameters.AddWithValue("@id", legacyUserId);
            var un = await cmd.ExecuteScalarAsync(ct);
            if (un is null)
            {
                report.Lines.Add($"کاربر قدیمی #{legacyUserId} پیدا نشد.");
                report.Errors++;
                return;
            }
            userName = Convert.ToString(un) ?? $"user{legacyUserId}";
        }

        await using (var cmd = new SqlCommand("SELECT * FROM Users WHERE Id=@id", conn))
        {
            cmd.Parameters.AddWithValue("@id", legacyUserId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                for (var i = 0; i < r.FieldCount; i++)
                {
                    var name = r.GetName(i);
                    if (r.IsDBNull(i)) continue;
                    if (name.Equals("FirstName", StringComparison.OrdinalIgnoreCase)) first = r.GetValue(i)?.ToString();
                    else if (name.Equals("LastName", StringComparison.OrdinalIgnoreCase)) last = r.GetValue(i)?.ToString();
                    else if (name.Equals("Email", StringComparison.OrdinalIgnoreCase)) email = r.GetValue(i)?.ToString();
                    else if (name.Equals("UserName", StringComparison.OrdinalIgnoreCase)) userName = r.GetValue(i)?.ToString() ?? userName;
                }
            }
        }

        var target = await _db.Users.FirstOrDefaultAsync(u => u.UserName == userName, ct);
        if (target is null)
        {
            target = new AppUser
            {
                UserName = userName,
                FirstName = first,
                LastName = last,
                Email = email,
                IsActive = true,
                Role = UserRole.User,
                PlanId = freePlan?.Id,
                CreatedAtUtc = DateTime.UtcNow,
                PreferredLanguage = "fa"
            };
            target.PasswordHash = _hasher.HashPassword(target, "ChangeMe123!");
            _db.Users.Add(target);
            await _db.SaveChangesAsync(ct);
            report.UsersCreated++;
            report.Lines.Add($"کاربر «{userName}» ساخته شد (رمز موقت ChangeMe123!).");
        }
        else
        {
            report.UsersMatched++;
            report.Lines.Add($"کاربر «{userName}» با حساب موجود #{target.Id} تطبیق داده شد.");
        }

        var taskIds = new HashSet<int>();
        if (hasCreator)
        {
            await using var cmd = new SqlCommand("SELECT Id FROM Tasks WHERE CreatorUserId=@uid", conn);
            cmd.Parameters.AddWithValue("@uid", legacyUserId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) taskIds.Add(r.GetInt32(0));
        }
        // Shared UserTasks are intentionally not imported — only owned processes.

        foreach (var taskId in taskIds.OrderBy(x => x))
        {
            try
            {
                var title = "فرآیند منتقل‌شده";
                await using (var cmd = new SqlCommand("SELECT Title FROM Tasks WHERE Id=@id", conn))
                {
                    cmd.Parameters.AddWithValue("@id", taskId);
                    var t = await cmd.ExecuteScalarAsync(ct);
                    if (t != null) title = Convert.ToString(t) ?? title;
                }

                // Skip duplicate title for same creator already transferred
                var exists = await _db.Processes.AnyAsync(p =>
                    p.CreatorUserId == target.Id
                    && p.Title == title
                    && p.DesignOrigin == TaskDesignOrigin.Transferred, ct);
                if (exists)
                {
                    report.ProcessesSkipped++;
                    report.Lines.Add($"  ⏭ فرآیند «{title}» قبلاً منتقل شده — رد شد.");
                    continue;
                }

                var graphJson = await CanvasBackfillService.ExportTaskGraphJsonAsync(conn, taskId, ct);
                if (string.IsNullOrWhiteSpace(graphJson))
                {
                    report.Errors++;
                    report.Lines.Add($"  ✗ فرآیند قدیمی #{taskId} («{title}»): گراف خالی/نامعتبر");
                    continue;
                }

                // Sources are independent library entities — do not import them with the process.
                graphJson = StripDataSourcesFromGraph(graphJson);

                var process = new Process
                {
                    Title = title.Length > 100 ? title[..100] : title,
                    CreatorUserId = target.Id,
                    DesignOrigin = TaskDesignOrigin.Transferred,
                    GraphJson = graphJson,
                    CreatedAtUtc = DateTime.UtcNow,
                    UpdatedAtUtc = DateTime.UtcNow
                };
                process.Shares.Add(new ProcessShare
                {
                    UserId = target.Id,
                    CanView = true,
                    CanEdit = true,
                    CanDelete = true,
                    CanExecute = true,
                    CanChangeDataSource = true,
                    GrantedAtUtc = DateTime.UtcNow,
                    GrantedByUserId = target.Id
                });
                _db.Processes.Add(process);
                await _db.SaveChangesAsync(ct);

                // Fix taskId inside JSON
                if (!string.IsNullOrWhiteSpace(process.GraphJson))
                {
                    try
                    {
                        var node = System.Text.Json.Nodes.JsonNode.Parse(process.GraphJson)?.AsObject();
                        if (node != null)
                        {
                            node["taskId"] = process.Id;
                            node["designOrigin"] = nameof(TaskDesignOrigin.Transferred);
                            node["dataSources"] = new System.Text.Json.Nodes.JsonArray();
                            node.Remove("dataSourceId");
                            process.GraphJson = node.ToJsonString(new System.Text.Json.JsonSerializerOptions
                            {
                                PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
                            });
                            await _db.SaveChangesAsync(ct);
                        }
                    }
                    catch { /* ignore */ }
                }

                report.ProcessesImported++;
                report.Lines.Add($"  ✓ فرآیند «{title}» → #{process.Id} (بدون منبع داده)");
            }
            catch (Exception ex)
            {
                report.Errors++;
                report.Lines.Add($"  ✗ فرآیند قدیمی #{taskId}: {ex.Message}");
            }
        }
    }

    /// <summary>Keep groups/steps/conditions; drop embedded Excel sources (library is separate).</summary>
    private static string StripDataSourcesFromGraph(string graphJson)
    {
        try
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(graphJson)?.AsObject();
            if (node is null) return graphJson;
            node["dataSources"] = new System.Text.Json.Nodes.JsonArray();
            node.Remove("dataSourceId");
            node.Remove("DataSources");
            if (node["nodes"] is System.Text.Json.Nodes.JsonArray nodes)
            {
                foreach (var n in nodes)
                {
                    if (n is not System.Text.Json.Nodes.JsonObject no) continue;
                    // Clear DS id refs; keep column name strings for later remapping.
                    foreach (var prop in new[]
                             {
                                 "dataSourceId", "sourceId", "selectorDataSourceId",
                                 "equalSelectorDataSourceId", "attributeDataSourceId",
                                 "equalAttributeDataSourceId", "saveDataSourceId"
                             })
                    {
                        if (no.ContainsKey(prop)) no[prop] = null;
                    }
                }
            }
            return node.ToJsonString(new System.Text.Json.JsonSerializerOptions
            {
                PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
            });
        }
        catch
        {
            return graphJson;
        }
    }

    private static async Task<bool> ColumnExists(SqlConnection conn, string table, string col, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(
            "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=@t AND COLUMN_NAME=@c", conn);
        cmd.Parameters.AddWithValue("@t", table);
        cmd.Parameters.AddWithValue("@c", col);
        return await cmd.ExecuteScalarAsync(ct) is not null;
    }
}
