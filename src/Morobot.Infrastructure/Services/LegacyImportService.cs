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
    /// <summary>
    /// True when this system already has an account with the same user name. The import matches on
    /// user name, so the operator needs to see which links will happen before running it.
    /// </summary>
    public bool MatchedHere { get; set; }
    /// <summary>Id of the existing account, when <see cref="MatchedHere"/> is true.</summary>
    public int? MatchedUserId { get; set; }
}

public class LegacyImportReport
{
    public List<string> Lines { get; } = new();
    public int UsersCreated { get; set; }
    public int UsersMatched { get; set; }
    public int ProcessesImported { get; set; }
    public int ProcessesSkipped { get; set; }
    public int Errors { get; set; }
    public int SourcesImported { get; set; }
    public int SourcesReused { get; set; }
}

/// <summary>One legacy process (task) owned by a user, shown before it is transferred.</summary>
public class LegacyProcessRow
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public DateTime? CreatedAt { get; set; }
    public int GroupCount { get; set; }
    public int StepsCount { get; set; }
    /// <summary>True when a Transferred copy of this legacy task already exists for the user.</summary>
    public bool AlreadyTransferred { get; set; }
}

/// <summary>One selected legacy user together with the processes that user owns.</summary>
public class LegacyUserProcesses
{
    public LegacyUserRow User { get; set; } = new();
    public List<LegacyProcessRow> Processes { get; set; } = new();
}

/// <summary>One group of a legacy process, with its steps, as shown in the details view.</summary>
public class LegacyGroupRow
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public int Priority { get; set; }
    public string? SourceType { get; set; }
    public int DataSourceId { get; set; }
    public int ParentGroupId { get; set; }
    public List<LegacyStepRow> Steps { get; } = new();
}

/// <summary>One step of a legacy group (the action it runs is shown by type, not body).</summary>
public class LegacyStepRow
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public int Priority { get; set; }
    public bool IsConditional { get; set; }
    public string? ActionType { get; set; }
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

            // Mark which legacy user names already exist here. The import links on user name, so
            // showing the match up front is what lets the operator confirm the connections rather
            // than discovering them in the result log.
            var names = list.Select(x => x.UserName).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
            var existing = await _db.Users.AsNoTracking()
                .Where(u => names.Contains(u.UserName))
                .Select(u => new { u.Id, u.UserName })
                .ToListAsync(ct);
            var byName = existing
                .GroupBy(x => x.UserName, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
            foreach (var row in list)
            {
                if (byName.TryGetValue(row.UserName ?? "", out var localId))
                {
                    row.MatchedHere = true;
                    row.MatchedUserId = localId;
                }
            }

            return (list, null);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Legacy list users failed");
            return (null, ex.Message);
        }
    }

    /// <summary>
    /// Second migration step: one legacy user plus the processes that user OWNS
    /// (<c>Tasks.CreatorUserId</c>). Processes shared through User_Tasks are deliberately excluded,
    /// matching what the import itself will transfer.
    /// </summary>
    public async Task<(LegacyUserRow? user, List<LegacyProcessRow>? processes, string? error)> ListProcessesAsync(
        string connectionString, int legacyUserId, CancellationToken ct = default)
    {
        try
        {
            await using var conn = new SqlConnection(connectionString);
            await conn.OpenAsync(ct);
            if (!await CanvasBackfillService.LegacyTableExistsAsync(conn, "Users", ct))
                return (null, null, "جدول Users در دیتابیس قدیمی پیدا نشد.");
            if (!await CanvasBackfillService.LegacyTableExistsAsync(conn, "Tasks", ct))
                return (null, null, "جدول Tasks در دیتابیس قدیمی پیدا نشد.");

            var hasFirst = await ColumnExists(conn, "Users", "FirstName", ct);
            var hasLast = await ColumnExists(conn, "Users", "LastName", ct);
            var hasCreator = await ColumnExists(conn, "Tasks", "CreatorUserId", ct);
            var hasTitle = await ColumnExists(conn, "Tasks", "Title", ct);
            var hasCreated = await ColumnExists(conn, "Tasks", "CreateTime", ct);
            var hasGroups = await CanvasBackfillService.LegacyTableExistsAsync(conn, "Groups", ct);

            var user = await ReadLegacyUserAsync(conn, legacyUserId, hasFirst, hasLast, ct);
            if (user is null) return (null, null, $"کاربر قدیمی #{legacyUserId} پیدا نشد.");

            var local = await _db.Users.AsNoTracking()
                .FirstOrDefaultAsync(u => u.UserName == user.UserName, ct);
            if (local is not null)
            {
                user.MatchedHere = true;
                user.MatchedUserId = local.Id;
            }

            var list = new List<LegacyProcessRow>();
            if (hasCreator)
            {
                var hasSteps = await CanvasBackfillService.LegacyTableExistsAsync(conn, "Steps", ct);
                var sql = $@"SELECT t.Id,
       {(hasTitle ? "t.Title" : "CAST(NULL AS nvarchar(200))")},
       {(hasCreated ? "t.CreateTime" : "CAST(NULL AS datetime)")},
       {(hasGroups ? "(SELECT COUNT(1) FROM Groups g WHERE g.TaskId = t.Id)" : "0")},
       {(hasSteps ? "(SELECT COUNT(1) FROM Steps s INNER JOIN Groups g2 ON s.GroupId = g2.Id WHERE g2.TaskId = t.Id)" : "0")}
FROM Tasks t WHERE t.CreatorUserId=@id ORDER BY t.Id";
                await using var cmd = new SqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("@id", legacyUserId);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct))
                {
                    list.Add(new LegacyProcessRow
                    {
                        Id = r.GetInt32(0),
                        Title = r.IsDBNull(1) ? "" : r.GetString(1),
                        CreatedAt = r.IsDBNull(2) ? null : r.GetDateTime(2),
                        GroupCount = r.IsDBNull(3) ? 0 : Convert.ToInt32(r.GetValue(3)),
                        StepsCount = r.IsDBNull(4) ? 0 : Convert.ToInt32(r.GetValue(4))
                    });
                }
            }

            user.ProcessCount = list.Count;
            return (user, list, null);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Legacy list processes failed");
            return (null, null, ex.Message);
        }
    }

    /// <summary>
    /// The process-selection step: every selected user with the processes that user OWNS
    /// (Tasks.CreatorUserId), each flagged with whether a transferred copy already exists here.
    /// The transfer itself refuses duplicates (legacyTaskId marker), so the flag is only the
    /// operator's guide — it prevents nothing on its own.
    /// </summary>
    public async Task<(List<LegacyUserProcesses>? groups, string? error)> ListProcessesForUsersAsync(
        string connectionString, IReadOnlyList<int> legacyUserIds, CancellationToken ct = default)
    {
        var groups = new List<LegacyUserProcesses>();
        foreach (var legacyUserId in legacyUserIds.Distinct())
        {
            var (user, processes, error) = await ListProcessesAsync(connectionString, legacyUserId, ct);
            if (user is null || processes is null)
                return (null, error ?? $"کاربر قدیمی #{legacyUserId} پیدا نشد.");

            // A transferred copy can only exist for a user who is already here (matched account).
            if (user.MatchedHere && user.MatchedUserId is int localId)
            {
                var transferred = await _db.Processes.AsNoTracking()
                    .Where(p => p.CreatorUserId == localId && p.DesignOrigin == TaskDesignOrigin.Transferred)
                    .Select(p => new { p.Title, p.GraphJson })
                    .ToListAsync(ct);
                foreach (var p in processes)
                {
                    p.AlreadyTransferred = transferred.Any(t =>
                        t.Title == p.Title
                        || (t.GraphJson ?? string.Empty).Contains("\"legacyTaskId\":" + p.Id));
                }
            }

            groups.Add(new LegacyUserProcesses { User = user, Processes = processes });
        }

        return (groups, null);
    }

    /// <summary>
    /// Read-only details of ONE legacy process: its groups and steps. The owner (CreatorUserId)
    /// is resolved from the task itself — a process with no owner cannot be inspected.
    /// </summary>
    public async Task<(LegacyUserRow? user, LegacyProcessRow? process, List<LegacyGroupRow>? groups, string? error)>
        ListProcessDetailsAsync(string connectionString, int taskId, CancellationToken ct = default)
    {
        try
        {
            await using var conn = new SqlConnection(connectionString);
            await conn.OpenAsync(ct);
            if (!await CanvasBackfillService.LegacyTableExistsAsync(conn, "Users", ct))
                return (null, null, null, "جدول Users در دیتابیس قدیمی پیدا نشد.");
            if (!await CanvasBackfillService.LegacyTableExistsAsync(conn, "Tasks", ct))
                return (null, null, null, "جدول Tasks در دیتابیس قدیمی پیدا نشد.");

            var hasFirst = await ColumnExists(conn, "Users", "FirstName", ct);
            var hasLast = await ColumnExists(conn, "Users", "LastName", ct);
            var hasCreator = await ColumnExists(conn, "Tasks", "CreatorUserId", ct);

            var hasTitle = await ColumnExists(conn, "Tasks", "Title", ct);
            var hasCreated = await ColumnExists(conn, "Tasks", "CreateTime", ct);
            LegacyProcessRow? process = null;
            int? creator = null;
            await using (var cmd = new SqlCommand(
                             $@"SELECT t.Id, {(hasTitle ? "t.Title" : "CAST(NULL AS nvarchar(200))")},
       {(hasCreated ? "t.CreateTime" : "CAST(NULL AS datetime)")},
       {(hasCreator ? "t.CreatorUserId" : "CAST(NULL AS int)")}
FROM Tasks t WHERE t.Id=@id", conn))
            {
                cmd.Parameters.AddWithValue("@id", taskId);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                if (await r.ReadAsync(ct))
                {
                    creator = r.IsDBNull(3) ? (int?)null : r.GetInt32(3);
                    process = new LegacyProcessRow
                    {
                        Id = r.GetInt32(0),
                        Title = r.IsDBNull(1) ? "" : r.GetString(1),
                        CreatedAt = r.IsDBNull(2) ? null : r.GetDateTime(2)
                    };
                }
            }
            if (process is null) return (null, null, null, $"فرآیند قدیمی #{taskId} پیدا نشد.");
            if (creator is null) return (null, null, null, $"مالک فرآیند #{taskId} مشخص نیست.");
            var user = await ReadLegacyUserAsync(conn, creator.Value, hasFirst, hasLast, ct);
            if (user is null) return (null, null, null, $"کاربر قدیمی #{creator.Value} پیدا نشد.");

            var groups = new List<LegacyGroupRow>();
            if (await CanvasBackfillService.LegacyTableExistsAsync(conn, "Groups", ct))
            {
                var gTitle = await ColumnExists(conn, "Groups", "Title", ct);
                var gPriority = await ColumnExists(conn, "Groups", "Priority", ct);
                var gSourceType = await ColumnExists(conn, "Groups", "SourceType", ct);
                var gSourceId = await ColumnExists(conn, "Groups", "DataSourceId", ct);
                var gParent = await ColumnExists(conn, "Groups", "ParrentGroupId", ct);

                await using (var cmd = new SqlCommand(
                                 $@"SELECT g.Id, {(gTitle ? "g.Title" : "CAST(NULL AS nvarchar(200))")},
       {(gPriority ? "g.Priority" : "0")},
       {(gSourceType ? "g.SourceType" : "CAST(NULL AS nvarchar(50))")},
       {(gSourceId ? "g.DataSourceId" : "0")},
       {(gParent ? "g.ParrentGroupId" : "0")}
FROM Groups g WHERE g.TaskId=@id ORDER BY {(gPriority ? "g.Priority, " : "")}g.Id", conn))
                {
                    cmd.Parameters.AddWithValue("@id", taskId);
                    await using var r = await cmd.ExecuteReaderAsync(ct);
                    while (await r.ReadAsync(ct))
                    {
                        groups.Add(new LegacyGroupRow
                        {
                            Id = r.GetInt32(0),
                            Title = r.IsDBNull(1) ? "" : r.GetString(1),
                            Priority = r.IsDBNull(2) ? 0 : Convert.ToInt32(r.GetValue(2)),
                            SourceType = r.IsDBNull(3) ? null : r.GetString(3),
                            DataSourceId = r.IsDBNull(4) ? 0 : Convert.ToInt32(r.GetValue(4)),
                            ParentGroupId = r.IsDBNull(5) ? 0 : Convert.ToInt32(r.GetValue(5))
                        });
                    }
                }

                if (groups.Count > 0 && await CanvasBackfillService.LegacyTableExistsAsync(conn, "Steps", ct))
                {
                    var sTitle = await ColumnExists(conn, "Steps", "Title", ct);
                    var sPriority = await ColumnExists(conn, "Steps", "Priority", ct);
                    var sConditional = await ColumnExists(conn, "Steps", "IsConditional", ct);
                    var hasActionType = await CanvasBackfillService.LegacyTableExistsAsync(conn, "Actions", ct)
                        && await ColumnExists(conn, "Steps", "ActionId", ct)
                        && await ColumnExists(conn, "Actions", "ActionType", ct);

                    await using var cmd = new SqlCommand(
                        $@"SELECT s.Id, s.GroupId, {(sTitle ? "s.Title" : "CAST(NULL AS nvarchar(200))")},
       {(sPriority ? "s.Priority" : "0")},
       {(sConditional ? "s.IsConditional" : "CAST(0 AS bit)")},
       {(hasActionType ? "a.ActionType" : "CAST(NULL AS nvarchar(50))")}
FROM Steps s
{(hasActionType ? "LEFT JOIN Actions a ON s.ActionId = a.Id" : "")}
WHERE s.GroupId IN (SELECT Id FROM Groups WHERE TaskId=@id)
ORDER BY {(sPriority ? "s.Priority, " : "")}s.Id", conn);
                    cmd.Parameters.AddWithValue("@id", taskId);
                    await using var r = await cmd.ExecuteReaderAsync(ct);
                    var byGroup = groups.ToDictionary(g => g.Id);
                    while (await r.ReadAsync(ct))
                    {
                        if (!byGroup.TryGetValue(r.GetInt32(1), out var g)) continue;
                        g.Steps.Add(new LegacyStepRow
                        {
                            Id = r.GetInt32(0),
                            Title = r.IsDBNull(2) ? "" : r.GetString(2),
                            Priority = r.IsDBNull(3) ? 0 : Convert.ToInt32(r.GetValue(3)),
                            IsConditional = !r.IsDBNull(4) && r.GetBoolean(4),
                            ActionType = r.IsDBNull(5) ? null : r.GetString(5)
                        });
                    }
                }
            }

            process.GroupCount = groups.Count;
            process.StepsCount = groups.Sum(g => g.Steps.Count);
            return (user, process, groups, null);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Legacy process details failed");
            return (null, null, null, ex.Message);
        }
    }

    private static async Task<LegacyUserRow?> ReadLegacyUserAsync(
        SqlConnection conn, int legacyUserId, bool hasFirst, bool hasLast, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(
            $@"SELECT Id, UserName,
       {(hasFirst ? "FirstName" : "CAST(NULL AS nvarchar(50))")},
       {(hasLast ? "LastName" : "CAST(NULL AS nvarchar(50))")}
FROM Users WHERE Id=@id", conn);
        cmd.Parameters.AddWithValue("@id", legacyUserId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        return new LegacyUserRow
        {
            Id = r.GetInt32(0),
            UserName = r.GetString(1),
            FirstName = r.IsDBNull(2) ? null : r.GetString(2),
            LastName = r.IsDBNull(3) ? null : r.GetString(3)
        };
    }

    /// <summary>
    /// Transfer an explicit selection of legacy processes. Each task is resolved to its owner
    /// (<c>Tasks.CreatorUserId</c>) and imported for that owner only; a task with no owner is
    /// refused. Every imported graph carries a <c>legacyTaskId</c> marker so the same task can
    /// never be transferred twice.
    /// </summary>
    public async Task<LegacyImportReport> ImportProcessesAsync(
        string connectionString, IReadOnlyList<int> taskIds, CancellationToken ct = default)
    {
        var report = new LegacyImportReport();
        if (taskIds.Count == 0)
        {
            report.Lines.Add("هیچ فرآیندی انتخاب نشده است.");
            return report;
        }

        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync(ct);

        var freePlan = await _db.Plans.FirstOrDefaultAsync(p => p.Code == nameof(PlanCode.Free), ct);
        var hasCreator = await ColumnExists(conn, "Tasks", "CreatorUserId", ct);
        var hasUserTasks = false;

        // Group the selection by owner — the ownership rule lives on Tasks.CreatorUserId.
        var byOwner = new Dictionary<int, List<int>>();
        foreach (var taskId in taskIds.Distinct())
        {
            int? creator = null;
            await using (var cmd = new SqlCommand(
                             hasCreator
                                 ? "SELECT CreatorUserId FROM Tasks WHERE Id=@id"
                                 : "SELECT CAST(NULL AS int) FROM Tasks WHERE Id=@id", conn))
            {
                cmd.Parameters.AddWithValue("@id", taskId);
                var v = await cmd.ExecuteScalarAsync(ct);
                if (v is not null && v is not DBNull) creator = Convert.ToInt32(v);
            }

            if (creator is null)
            {
                report.Errors++;
                report.Lines.Add($"  ✗ فرآیند قدیمی #{taskId}: بدون مالک — رد شد.");
                continue;
            }

            if (!byOwner.TryGetValue(creator.Value, out var ids))
                byOwner[creator.Value] = ids = new List<int>();
            ids.Add(taskId);
        }

        // Copies created in this run, keyed by owner + legacy source id. A private legacy source is
        // reused across the run for its owner; a public one arrives as that owner's copy.
        var sourceMap = new Dictionary<(int OwnerUserId, int LegacySourceId), SourceMeta>();

        foreach (var (ownerId, ids) in byOwner)
        {
            try
            {
                await ImportOneUserAsync(conn, ownerId, freePlan, hasCreator, hasUserTasks, sourceMap, report, ct,
                    new HashSet<int>(ids));
            }
            catch (Exception ex)
            {
                report.Errors++;
                report.Lines.Add($"خطا برای کاربر #{ownerId}: {ex.Message}");
                _log.LogError(ex, "Import processes for user {Id}", ownerId);
            }
        }

        return report;
    }

    private async Task ImportOneUserAsync(
        SqlConnection conn, int legacyUserId, Plan? freePlan,
        bool hasCreator, bool hasUserTasks,
        Dictionary<(int OwnerUserId, int LegacySourceId), SourceMeta> sourceMap,
        LegacyImportReport report, CancellationToken ct,
        IReadOnlyCollection<int>? onlyTaskIds = null)
    {
        string userName;
        string? first = null, last = null, email = null, secret = null;
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
                    else if (name.Equals("Password", StringComparison.OrdinalIgnoreCase)) secret = r.GetValue(i)?.ToString();
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
            // The legacy system stored passwords in clear text, so the same password is carried
            // over and the user signs in with what they already know. Only an empty legacy value
            // falls back to a temporary password.
            target.PasswordHash = _hasher.HashPassword(target,
                string.IsNullOrWhiteSpace(secret) ? "ChangeMe123!" : secret!);
            _db.Users.Add(target);
            await _db.SaveChangesAsync(ct);
            report.UsersCreated++;
            report.Lines.Add(string.IsNullOrWhiteSpace(secret)
                ? $"کاربر «{userName}» ساخته شد (رمز موقت ChangeMe123!)."
                : $"کاربر «{userName}» ساخته شد (رمز برابر رمز قدیمی).");
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
        if (onlyTaskIds is { Count: > 0 })
            taskIds = new HashSet<int>(taskIds.Where(onlyTaskIds.Contains));

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

                // Never transfer the same legacy task twice. The imported graph carries a
                // "legacyTaskId" marker; the title check covers copies imported before the
                // marker existed.
                var marker = "\"legacyTaskId\":" + taskId;
                var exists = await _db.Processes.AnyAsync(p =>
                    p.CreatorUserId == target.Id
                    && p.DesignOrigin == TaskDesignOrigin.Transferred
                    && ((p.GraphJson ?? string.Empty).Contains(marker) || p.Title == title), ct);
                if (exists)
                {
                    report.ProcessesSkipped++;
                    report.Lines.Add($"  ⏭ فرآیند «{title}» (قدیمی #{taskId}) قبلاً منتقل شده — رد شد.");
                    continue;
                }

                var graphJson = await CanvasBackfillService.ExportTaskGraphJsonAsync(conn, taskId, ct);
                if (string.IsNullOrWhiteSpace(graphJson))
                {
                    report.Errors++;
                    report.Lines.Add($"  ✗ فرآیند قدیمی #{taskId} («{title}»): گراف خالی/نامعتبر");
                    continue;
                }

                // Sources ARE transferred now: every source this task references (groups, actions,
                // selectors, conditions) is copied into the owner's library, linked to the new
                // process and bound back into the graph (owner, 2026-10-02: a public source arrives
                // as a copy for the process owner; the owner's own sources are reused across the run).
                var sourceResult = await ImportReferencedSourcesAsync(
                    conn, graphJson, target.Id, sourceMap, report, ct);
                graphJson = sourceResult.GraphJson;

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
                            node["legacyTaskId"] = taskId;
                            node["designOrigin"] = nameof(TaskDesignOrigin.Transferred);
                            // Root dataSources/dataSourceId were written by the source importer — keep them.
                            // The editor rewrites the graph when it saves and drops unknown ROOT fields,
                            // so the marker also goes on the start node — node-level extras survive.
                            if (node["nodes"] is System.Text.Json.Nodes.JsonArray nodesArr)
                            {
                                foreach (var n in nodesArr)
                                {
                                    if (n is System.Text.Json.Nodes.JsonObject no
                                        && string.Equals(no["kind"]?.GetValue<string>(), "start", StringComparison.OrdinalIgnoreCase))
                                    {
                                        no["legacyTaskId"] = taskId;
                                        break;
                                    }
                                }
                            }
                            process.GraphJson = node.ToJsonString(new System.Text.Json.JsonSerializerOptions
                            {
                                PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
                            });
                            await _db.SaveChangesAsync(ct);
                        }
                    }
                    catch { /* ignore */ }
                }

                // Link every imported source to the process; the source the start repeats on is the
                // process default (mirrors the old "first group's source" master).
                if (sourceResult.Links.Count > 0)
                {
                    var order = 0;
                    foreach (var (newSourceId, isMaster) in sourceResult.Links)
                    {
                        _db.ProcessDataSources.Add(new ProcessDataSource
                        {
                            ProcessId = process.Id,
                            DataSourceId = newSourceId,
                            IsDefault = isMaster,
                            SortOrder = order++
                        });
                    }
                    await _db.SaveChangesAsync(ct);
                }

                report.ProcessesImported++;
                report.Lines.Add($"  ✓ فرآیند «{title}» → #{process.Id}"
                    + (sourceResult.Links.Count > 0 ? $" (+{sourceResult.Links.Count} منبع)" : " (بدون منبع)"));
            }
            catch (Exception ex)
            {
                report.Errors++;
                report.Lines.Add($"  ✗ فرآیند قدیمی #{taskId}: {ex.Message}");
            }
        }
    }

    /// <summary>Metadata of a source copied into the target library during one import run.</summary>
    private sealed record SourceMeta(
        int Id, string Title, string? FileName, int RowCount, int ColumnCount, long DataRevision,
        List<(string Key, string Title)> Columns);

    private sealed class SourceImportResult
    {
        public string GraphJson { get; set; } = string.Empty;
        public List<(int NewId, bool IsMaster)> Links { get; } = new();
    }

    /// <summary>Graph keys that reference a data source by id (mirrors the editor's binding pairs).</summary>
    private static readonly string[] SourceRefKeys =
    {
        "dataSourceId", "selectorDataSourceId", "equalSelectorDataSourceId",
        "attributeDataSourceId", "equalAttributeDataSourceId", "saveDataSourceId"
    };

    /// <summary>
    /// Copy every data source the exported graph references into the target user's library, remap
    /// the node bindings onto the new ids and embed the source summaries in the graph.
    ///
    /// Legacy semantics (owner, 2026-10-02): a PUBLIC source (GroupDataSources.IsGlobal) used by a
    /// process arrives as a COPY for the process owner; a private source is the owner's own and is
    /// reused across the run (deduplicated per owner + legacy id).
    /// </summary>
    private async Task<SourceImportResult> ImportReferencedSourcesAsync(
        SqlConnection conn, string graphJson, int ownerUserId,
        Dictionary<(int OwnerUserId, int LegacySourceId), SourceMeta> sourceMap,
        LegacyImportReport report, CancellationToken ct)
    {
        var result = new SourceImportResult { GraphJson = graphJson };
        System.Text.Json.Nodes.JsonObject? graph = null;
        try { graph = System.Text.Json.Nodes.JsonNode.Parse(graphJson) as System.Text.Json.Nodes.JsonObject; }
        catch { /* leave the graph untouched */ }
        if (graph is null) return result;

        var referenced = new SortedSet<int>();
        void Scan(System.Text.Json.Nodes.JsonObject o)
        {
            foreach (var key in SourceRefKeys)
            {
                if (o[key] is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<int>(out var idRef) && idRef > 0)
                    referenced.Add(idRef);
            }
        }

        var startSourceId = 0;
        if (graph["nodes"] is System.Text.Json.Nodes.JsonArray nodes)
        {
            foreach (var n in nodes)
            {
                if (n is not System.Text.Json.Nodes.JsonObject no) continue;
                Scan(no);
                if (no["kind"]?.GetValue<string>() == "start"
                    && no["dataSourceId"] is System.Text.Json.Nodes.JsonValue sv
                    && sv.TryGetValue<int>(out var sid) && sid > 0)
                {
                    startSourceId = sid;
                }
                if (no["conditions"] is System.Text.Json.Nodes.JsonArray conds)
                {
                    foreach (var c in conds)
                        if (c is System.Text.Json.Nodes.JsonObject co) Scan(co);
                }
            }
        }

        if (referenced.Count == 0) return result;

        var metas = new List<(int LegacyId, SourceMeta Meta)>();
        foreach (var legacyId in referenced)
        {
            try
            {
                if (!sourceMap.TryGetValue((ownerUserId, legacyId), out var meta))
                {
                    var payload = await LoadLegacySourceAsync(conn, legacyId, ct);
                    if (payload is null)
                    {
                        report.Lines.Add($"     ⚠ منبع قدیمی #{legacyId} پیدا نشد — ارجاع‌هایش خالی شد.");
                        continue;
                    }

                    var columnsJson = new System.Text.Json.Nodes.JsonArray();
                    foreach (var (key, colTitle) in payload.Columns)
                        columnsJson.Add(new System.Text.Json.Nodes.JsonObject { ["key"] = key, ["title"] = colTitle });

                    var entity = new DataSource
                    {
                        OwnerUserId = ownerUserId,
                        Title = payload.Title,
                        FileName = null,
                        ColumnCount = payload.Columns.Count,
                        RowCount = payload.RowCount,
                        ColumnsJson = columnsJson.ToJsonString(),
                        CellsJson = "[]",
                        DataRevision = 1,
                        CreatedAtUtc = DateTime.UtcNow,
                        UpdatedAtUtc = DateTime.UtcNow,
                        LastEditorUserId = ownerUserId
                    };
                    foreach (var (row, key, value) in payload.Cells)
                    {
                        entity.Cells.Add(new DataSourceCell
                        {
                            RowIndex = row,
                            ColumnKey = key,
                            CellValue = value,
                            CellRevision = 0
                        });
                    }
                    _db.DataSources.Add(entity);
                    await _db.SaveChangesAsync(ct);

                    meta = new SourceMeta(entity.Id, payload.Title, null, payload.RowCount,
                        payload.Columns.Count, entity.DataRevision, payload.Columns);
                    sourceMap[(ownerUserId, legacyId)] = meta;
                    report.SourcesImported++;
                    report.Lines.Add($"     ↳ منبع «{payload.Title}» منتقل شد (#{meta.Id}، {payload.Cells.Count} سلول — {payload.MergeNote}).");
                    if (payload.BlobWarning is not null)
                        report.Lines.Add($"       ⚠ blob منبع #{legacyId} خوانده نشد ({payload.BlobWarning})؛ فقط سلول‌های جدول منتقل شدند.");
                }
                else
                {
                    report.SourcesReused++;
                }
                metas.Add((legacyId, meta));
            }
            catch (Exception ex)
            {
                report.Lines.Add($"     ⚠ منبع قدیمی #{legacyId}: {ex.Message}");
            }
        }

        var byLegacy = metas.ToDictionary(m => m.LegacyId, m => m.Meta);

        // Remap every binding onto the new ids (references to a source that could not be loaded are cleared).
        void Remap(System.Text.Json.Nodes.JsonObject o)
        {
            foreach (var key in SourceRefKeys)
            {
                if (o[key] is System.Text.Json.Nodes.JsonValue v
                    && v.TryGetValue<int>(out var oldId) && oldId > 0)
                {
                    o[key] = byLegacy.TryGetValue(oldId, out var mapped) ? mapped.Id : null;
                }
            }
        }
        if (graph["nodes"] is System.Text.Json.Nodes.JsonArray nodes2)
        {
            foreach (var n in nodes2)
            {
                if (n is not System.Text.Json.Nodes.JsonObject no) continue;
                Remap(no);
                if (no["conditions"] is System.Text.Json.Nodes.JsonArray conds2)
                {
                    foreach (var c in conds2)
                        if (c is System.Text.Json.Nodes.JsonObject co) Remap(co);
                }
            }
        }

        // Embed the source summaries the editor renders on the canvas and in the process panel.
        var embedded = new System.Text.Json.Nodes.JsonArray();
        foreach (var (_, meta) in metas)
        {
            var cols = new System.Text.Json.Nodes.JsonArray();
            var keys = new System.Text.Json.Nodes.JsonArray();
            foreach (var (key, colTitle) in meta.Columns)
            {
                cols.Add(new System.Text.Json.Nodes.JsonObject { ["key"] = key, ["title"] = colTitle });
                keys.Add(key);
            }
            embedded.Add(new System.Text.Json.Nodes.JsonObject
            {
                ["id"] = meta.Id,
                ["title"] = meta.Title,
                ["fileName"] = meta.FileName,
                ["columnCount"] = meta.ColumnCount,
                ["rowCount"] = meta.RowCount,
                ["dataRevision"] = meta.DataRevision,
                ["columnKeys"] = keys,
                ["columns"] = cols
            });
        }
        graph["dataSources"] = embedded;

        // Process master source = the source the start repeats on (legacy: the first group's source).
        var masterNewId = startSourceId > 0 && byLegacy.TryGetValue(startSourceId, out var masterMeta)
            ? masterMeta.Id
            : metas.Count > 0 ? metas[0].Meta.Id : (int?)null;
        if (masterNewId is int mnid)
        {
            graph["dataSourceId"] = mnid;
            if (graph["nodes"] is System.Text.Json.Nodes.JsonArray nodes3)
            {
                foreach (var n in nodes3)
                {
                    if (n is System.Text.Json.Nodes.JsonObject no3
                        && no3["kind"]?.GetValue<string>() == "start"
                        && no3["dataSourceId"] is null)
                    {
                        no3["dataSourceId"] = mnid;
                    }
                }
            }
        }

        foreach (var (_, meta) in metas)
            result.Links.Add((meta.Id, masterNewId == meta.Id));
        result.GraphJson = graph.ToJsonString(new System.Text.Json.JsonSerializerOptions
        {
            PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
        });
        return result;
    }

    private sealed class LegacySourcePayload
    {
        public string Title { get; init; } = "";
        public int RowCount { get; init; }
        public List<(string Key, string Title)> Columns { get; init; } = new();
        public List<(int Row, string Key, string Value)> Cells { get; init; } = new();
        public string MergeNote { get; init; } = "";
        public string? BlobWarning { get; init; }
    }

    /// <summary>
    /// Read one legacy source. The Windows-era app kept the parsed matrix in two places that must be
    /// MERGED: the base table serialized inside <c>GroupDataSources.Source</c> (BinaryFormatter
    /// DataTable, Xml diffgram) plus the cell overrides recorded row-by-row in
    /// <c>DataSourceRows</c> (RowIndex + ColoumnName + CellValue). The overlay wins; it may extend
    /// the base with additional rows and columns. If the blob is missing/unreadable the table alone
    /// is transferred (with a warning).
    /// </summary>
    private static async Task<LegacySourcePayload?> LoadLegacySourceAsync(
        SqlConnection conn, int legacyId, CancellationToken ct)
    {
        if (!await TableExistsAsync(conn, "GroupDataSources", ct)) return null;

        var title = $"منبع قدیمی #{legacyId}";
        var rowsCount = 0;
        byte[]? blob = null;
        // "Source" holds the serialized DataTable; older schemas may not have it.
        var hasBlobColumn = await ColumnExists(conn, "GroupDataSources", "Source", ct);
        var headerSql = hasBlobColumn
            ? "SELECT Title, RowsCount, Source FROM GroupDataSources WHERE Id=@id"
            : "SELECT Title, RowsCount, NULL FROM GroupDataSources WHERE Id=@id";
        await using (var cmd = new SqlCommand(headerSql, conn))
        {
            cmd.Parameters.AddWithValue("@id", legacyId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return null;
            title = r.IsDBNull(0) ? title : (Convert.ToString(r.GetValue(0)) ?? title).Trim();
            rowsCount = r.IsDBNull(1) ? 0 : Convert.ToInt32(r.GetValue(1));
            if (!r.IsDBNull(2)) blob = r.GetValue(2) as byte[];
        }

        // 1) Base matrix from the blob (schema order).
        var columns = new List<string>();
        var known = new HashSet<string>(StringComparer.Ordinal);
        var values = new Dictionary<(int Row, string Col), string>();
        var maxRow = -1;
        string? blobWarning = null;
        string mergeNote;
        if (blob is { Length: > 0 })
        {
            var table = LegacyDataTableBlob.TryRead(blob, out var blobMessage);
            if (table is null)
            {
                blobWarning = blobMessage;
                mergeNote = "blob ناخوانا — فقط جدول";
            }
            else
            {
                foreach (var colName in table.Columns)
                {
                    if (colName.Length == 0 || !known.Add(colName)) continue;
                    columns.Add(colName);
                }
                for (var i = 0; i < table.Rows.Count; i++)
                {
                    var row = table.Rows[i];
                    for (var c = 0; c < columns.Count && c < row.Length; c++)
                    {
                        if (row[c].Length > 0) values[(i, columns[c])] = row[c];
                    }
                }
                if (table.Rows.Count > 0) maxRow = table.Rows.Count - 1;
                mergeNote = $"پایه blob «{table.TableName}»: {table.Rows.Count} ردیف × {columns.Count} ستون";
            }
        }
        else
        {
            mergeNote = "بدون blob";
        }

        // 2) Overlay DataSourceRows (table wins; may add columns and rows beyond the blob).
        var overlayCells = 0;
        if (await TableExistsAsync(conn, "DataSourceRows", ct))
        {
            await using (var cmd = new SqlCommand(
                             "SELECT ColoumnName, MIN(Id) AS FirstId FROM DataSourceRows WHERE SourceId=@id GROUP BY ColoumnName ORDER BY FirstId", conn))
            {
                cmd.Parameters.AddWithValue("@id", legacyId);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct))
                {
                    var name = r.IsDBNull(0) ? "" : (Convert.ToString(r.GetValue(0)) ?? "").Trim();
                    if (name.Length == 0 || !known.Add(name)) continue;
                    columns.Add(name);
                }
            }

            await using (var cmd = new SqlCommand(
                             "SELECT RowIndex, ColoumnName, CellValue FROM DataSourceRows WHERE SourceId=@id ORDER BY Id", conn))
            {
                cmd.Parameters.AddWithValue("@id", legacyId);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                var seen = new HashSet<(int, string)>();
                while (await r.ReadAsync(ct))
                {
                    var row = r.IsDBNull(0) ? -1 : Convert.ToInt32(r.GetValue(0));
                    if (row < 0) continue;
                    var key = r.IsDBNull(1) ? "" : (Convert.ToString(r.GetValue(1)) ?? "").Trim();
                    if (key.Length == 0 || !known.Contains(key)) continue;
                    if (!seen.Add((row, key))) continue;
                    // The table always overrides the blob — including explicit clears (empty value).
                    values[(row, key)] = r.IsDBNull(2) ? "" : Convert.ToString(r.GetValue(2)) ?? "";
                    overlayCells++;
                    if (row > maxRow) maxRow = row;
                }
            }
            if (overlayCells > 0) mergeNote += $"; بازنویسی جدولی: {overlayCells} سلول";
        }

        var colIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < columns.Count; i++) colIndex[columns[i]] = i;
        var cells = values
            .Where(kv => kv.Value.Length > 0)
            .OrderBy(kv => kv.Key.Row).ThenBy(kv => colIndex[kv.Key.Col])
            .Select(kv => (kv.Key.Row, kv.Key.Col, kv.Value))
            .ToList();

        return new LegacySourcePayload
        {
            Title = title.Length > 200 ? title[..200] : title,
            RowCount = Math.Max(rowsCount, maxRow + 1),
            Columns = columns.Select(c => (c, c)).ToList(),
            Cells = cells,
            MergeNote = mergeNote,
            BlobWarning = blobWarning
        };
    }

    private static async Task<bool> TableExistsAsync(SqlConnection conn, string table, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(
            "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @t", conn);
        cmd.Parameters.AddWithValue("@t", table);
        var v = await cmd.ExecuteScalarAsync(ct);
        return v is not null && v is not DBNull;
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
