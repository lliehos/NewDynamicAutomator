using System.Security.Claims;
using Morobot.Contracts.Auth;
using Morobot.Domain;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Services;

public class EntitlementService
{
    public const string ClaimPlan = "plan";
    public const string ClaimRole = "role";
    public const string ClaimCanPlay = "can_play";
    public const string ClaimCanSelector = "can_selector";
    public const string ClaimCanRecord = "can_record";
    public const string ClaimCanSmart = "can_smart";
    public const string ClaimCanShare = "can_share";
    public const string ClaimMaxTasks = "max_tasks";
    public const string ClaimMaxSources = "max_sources";
    public const string ClaimIsLocal = "is_local";

    private readonly AppDbContext _db;

    public EntitlementService(AppDbContext db) => _db = db;

    public static EntitlementsDto LocalDefaults() => new()
    {
        PlanCode = nameof(PlanCode.Local),
        PlanNameFa = "محلی",
        PlanNameEn = "Local",
        IsLocal = true,
        CanPlay = false,
        CanSelector = false,
        CanRecord = false,
        CanSmart = false,
        CanShare = false,
        MaxTasks = 1,
        MaxDataSources = 1
    };

    public static EntitlementsDto FromPlan(Plan plan, DateTime? expires = null) => new()
    {
        PlanCode = plan.Code,
        PlanNameFa = plan.NameFa,
        PlanNameEn = plan.NameEn,
        IsLocal = PasswordPolicy.IsLocal(plan.Code),
        CanPlay = plan.CanPlay,
        CanSelector = plan.CanSelector,
        CanRecord = plan.CanRecord,
        CanSmart = plan.CanSmart,
        CanShare = plan.CanShare,
        CanReceiveShare = plan.CanReceiveShare,
        MaxSharesPerTask = plan.MaxSharesPerTask,
        ShareAllowView = plan.ShareAllowView,
        ShareAllowEdit = plan.ShareAllowEdit,
        ShareAllowDelete = plan.ShareAllowDelete,
        ShareAllowExecute = plan.ShareAllowExecute,
        ShareAllowChangeDataSource = plan.ShareAllowChangeDataSource,
        MaxTasks = plan.MaxTasks,
        MaxDataSources = plan.MaxDataSources,
        PlanExpiresAtUtc = expires
    };

    public static EntitlementsDto FromClaims(ClaimsPrincipal user)
    {
        var plan = user.FindFirstValue(ClaimPlan) ?? nameof(PlanCode.Local);
        var isLocal = string.Equals(user.FindFirstValue(ClaimIsLocal), "1", StringComparison.Ordinal)
                      || string.Equals(plan, nameof(PlanCode.Local), StringComparison.OrdinalIgnoreCase);
        return new EntitlementsDto
        {
            PlanCode = plan,
            PlanNameFa = plan,
            PlanNameEn = plan,
            IsLocal = isLocal,
            CanPlay = user.FindFirstValue(ClaimCanPlay) == "1",
            CanSelector = user.FindFirstValue(ClaimCanSelector) == "1",
            CanRecord = user.FindFirstValue(ClaimCanRecord) == "1",
            CanSmart = user.FindFirstValue(ClaimCanSmart) == "1",
            CanShare = user.FindFirstValue(ClaimCanShare) == "1",
            MaxTasks = ParseNullableInt(user.FindFirstValue(ClaimMaxTasks)),
            MaxDataSources = ParseNullableInt(user.FindFirstValue(ClaimMaxSources))
        };
    }

    public async Task<EntitlementsDto> ResolveForUserAsync(AppUser user, CancellationToken ct = default)
    {
        Plan? plan = user.Plan;
        if (plan is null && user.PlanId is int pid)
            plan = await _db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == pid, ct);

        if (plan is null)
        {
            plan = await _db.Plans.AsNoTracking()
                .FirstOrDefaultAsync(p => p.Code == nameof(PlanCode.Local), ct);
            if (plan is null)
                return LocalDefaults();
        }

        return FromPlan(plan, user.PlanExpiresAtUtc);
    }

    public async Task<EntitlementsDto> ResolveWithCountsAsync(int userId, ClaimsPrincipal principal, CancellationToken ct = default)
    {
        var fromClaims = FromClaims(principal);
        if (userId <= 0)
            return fromClaims;

        var dbUser = await _db.Users.AsNoTracking()
            .Include(u => u.Plan)
            .FirstOrDefaultAsync(u => u.Id == userId, ct);
        var entitlements = dbUser is null
            ? fromClaims
            : await ResolveForUserAsync(dbUser, ct);

        entitlements.TaskCount = await _db.UserTaskAccess.CountAsync(a => a.UserId == userId, ct);
        entitlements.DataSourceCount = await CountCanvasDataSourcesAsync(userId, ct);
        return entitlements;
    }

    public async Task EnsureCanCreateTaskAsync(int userId, EntitlementsDto entitlements, CancellationToken ct = default)
    {
        if (entitlements.MaxTasks is null)
            return;
        var count = await _db.UserTaskAccess.CountAsync(a => a.UserId == userId, ct);
        if (count >= entitlements.MaxTasks.Value)
            throw new InvalidOperationException($"Task limit reached ({entitlements.MaxTasks}).");
    }

    public async Task EnsureCanCreateDataSourceAsync(int userId, EntitlementsDto entitlements, CancellationToken ct = default)
    {
        if (entitlements.MaxDataSources is null)
            return;
        var count = await CountCanvasDataSourcesAsync(userId, ct);
        if (count >= entitlements.MaxDataSources.Value)
            throw new InvalidOperationException($"Data source limit reached ({entitlements.MaxDataSources}).");
    }

    public async Task EnsureCanvasWithinSourceLimitAsync(int userId, string canvasJson, EntitlementsDto entitlements, CancellationToken ct = default)
    {
        if (entitlements.MaxDataSources is null)
            return;
        var inCanvas = CountSourcesInCanvasJson(canvasJson);
        // Other tasks' sources + this canvas (replace) — approximate: sum all canvases excluding current happens on save with task id.
        var total = await CountCanvasDataSourcesAsync(userId, ct);
        // When saving, caller should pass delta; here we reject if this single canvas alone exceeds max.
        if (inCanvas > entitlements.MaxDataSources.Value)
            throw new InvalidOperationException($"Data source limit reached ({entitlements.MaxDataSources}).");
        _ = total;
        await Task.CompletedTask;
    }

    public async Task<int> CountCanvasDataSourcesAsync(int userId, CancellationToken ct = default)
    {
        var jsons = await _db.Tasks
            .Where(t => t.CreatorUserId == userId || t.UserAccess.Any(a => a.UserId == userId))
            .Select(t => t.CanvasJson)
            .ToListAsync(ct);
        var sum = 0;
        foreach (var j in jsons)
            sum += CountSourcesInCanvasJson(j);
        // Also count relational sources owned by user
        sum += await _db.DataSources.CountAsync(d => d.UserId == userId, ct);
        return sum;
    }

    /// <summary>Count dataSources array entries inside editor canvas JSON.</summary>
    public static int CountSourcesInCanvasJson(string? canvasJson)
    {
        if (string.IsNullOrWhiteSpace(canvasJson)) return 0;
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(canvasJson);
            if (doc.RootElement.TryGetProperty("dataSources", out var arr) && arr.ValueKind == System.Text.Json.JsonValueKind.Array)
                return arr.GetArrayLength();
            if (doc.RootElement.TryGetProperty("DataSources", out var arr2) && arr2.ValueKind == System.Text.Json.JsonValueKind.Array)
                return arr2.GetArrayLength();
        }
        catch { /* ignore */ }
        return 0;
    }

    private static int? ParseNullableInt(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value == "*")
            return null;
        return int.TryParse(value, out var n) ? n : null;
    }
}
