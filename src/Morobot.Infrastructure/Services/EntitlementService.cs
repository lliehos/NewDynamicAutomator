using System.Security.Claims;
using Morobot.Contracts.Auth;
using Morobot.Domain;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Morobot.Licensing;
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
    public const string ClaimMaxProcessSteps = "max_process_steps";
    public const string ClaimIsLocal = "is_local";

    private readonly AppDbContext _db;
    private readonly LicenseService _licenses;

    public EntitlementService(AppDbContext db, LicenseService licenses)
    {
        _db = db;
        _licenses = licenses;
    }

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
        MaxDataSources = 1,
        MaxProcessSteps = 30
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
        MaxProcessSteps = plan.MaxProcessSteps,
        MaxSourceRows = plan.MaxSourceRows,
        MaxSourceBytes = plan.MaxSourceBytes,
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
            MaxDataSources = ParseNullableInt(user.FindFirstValue(ClaimMaxSources)),
            MaxProcessSteps = ParseNullableInt(user.FindFirstValue(ClaimMaxProcessSteps))
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
                return await ApplyLicenseCeilingAsync(LocalDefaults(), ct);
        }

        return await ApplyLicenseCeilingAsync(FromPlan(plan, user.PlanExpiresAtUtc), ct);
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
            ? await ApplyLicenseCeilingAsync(fromClaims, ct)
            : await ResolveForUserAsync(dbUser, ct);

        entitlements.TaskCount = await _db.ProcessShares.CountAsync(a => a.UserId == userId, ct);
        entitlements.DataSourceCount = await CountCanvasDataSourcesAsync(userId, ct);
        return entitlements;
    }

    /// <summary>
    /// Lower the plan's per-source ceilings to the signed license's. The license is a hard ceiling
    /// the deployment cannot raise, so a plan that allows more rows than was licensed is clamped
    /// down; a plan with no cap of its own inherits the licensed cap.
    /// </summary>
    /// <remarks>
    /// Deliberately "lower, never raise": the admin's plan is a self-service setting, the license is
    /// a signed contract, and only the contract may decide the outer bound.
    /// </remarks>
    public async Task<EntitlementsDto> ApplyLicenseCeilingAsync(EntitlementsDto entitlements, CancellationToken ct = default)
    {
        LicenseRuntimeState runtime;
        try { runtime = await _licenses.GetRuntimeStateAsync(ct); }
        catch { return entitlements; }

        var licenseRows = runtime.MaxSourceRows;
        var licenseBytes = runtime.MaxSourceBytes;

        if (licenseRows is int lr)
        {
            var planRows = entitlements.MaxSourceRows;
            entitlements.MaxSourceRows = planRows is int pr ? Math.Min(pr, lr) : lr;
            entitlements.SourceLimitFromLicense = planRows is null || planRows > lr;
        }
        if (licenseBytes is long lb)
        {
            var planBytes = entitlements.MaxSourceBytes;
            entitlements.MaxSourceBytes = planBytes is long pb ? Math.Min(pb, lb) : lb;
            entitlements.SourceLimitFromLicense = entitlements.SourceLimitFromLicense || planBytes is null || planBytes > lb;
        }
        return entitlements;
    }

    /// <summary>
    /// Refuse a source whose content exceeds the effective ceiling. Checked on every write path
    /// (create / import / reload / insert) because each is an independent way to grow a source.
    /// </summary>
    /// <returns>null when allowed, otherwise a Persian explanation the caller can surface.</returns>
    public static string? CheckSourceLimits(EntitlementsDto entitlements, int rowCount, long byteCount)
    {
        if (entitlements.MaxSourceRows is int maxRows && rowCount > maxRows)
        {
            var reason = entitlements.SourceLimitFromLicense ? "لایسنس" : "سطح کاربری";
            return $"تعداد ردیف‌های منبع ({rowCount}) از سقف مجاز {reason} ({maxRows}) بیشتر است.";
        }
        if (entitlements.MaxSourceBytes is long maxBytes && byteCount > maxBytes)
        {
            var reason = entitlements.SourceLimitFromLicense ? "لایسنس" : "سطح کاربری";
            return $"حجم منبع ({FormatBytes(byteCount)}) از سقف مجاز {reason} ({FormatBytes(maxBytes)}) بیشتر است.";
        }
        return null;
    }

    /// <summary>UTF-8 size of the source's content — the same measure the byte ceiling is stated in.</summary>
    public static long MeasureSourceBytes(IEnumerable<IEnumerable<string?>> rows)
    {
        long total = 0;
        foreach (var row in rows)
        {
            foreach (var cell in row)
                total += cell is null ? 0 : System.Text.Encoding.UTF8.GetByteCount(cell);
        }
        return total;
    }

    private static string FormatBytes(long bytes)
        => bytes >= 1024 * 1024
            ? $"{bytes / (1024d * 1024d):0.##} MB"
            : bytes >= 1024 ? $"{bytes / 1024d:0.##} KB" : $"{bytes} B";


    public async Task EnsureCanCreateTaskAsync(int userId, EntitlementsDto entitlements, CancellationToken ct = default)
    {
        if (entitlements.MaxTasks is null)
            return;
        var count = await _db.ProcessShares.CountAsync(a => a.UserId == userId, ct);
        if (count >= entitlements.MaxTasks.Value)
            throw new InvalidOperationException($"Task limit reached ({entitlements.MaxTasks}).");
    }

    public async Task EnsureCanCreateDataSourceAsync(int userId, EntitlementsDto entitlements, CancellationToken ct = default)
    {
        if (entitlements.MaxDataSources is null)
            return;
        var count = await CountLibraryDataSourcesAsync(userId, ct);
        if (count >= entitlements.MaxDataSources.Value)
            throw new InvalidOperationException($"Data source limit reached ({entitlements.MaxDataSources}).");
    }

    public async Task EnsureCanvasWithinSourceLimitAsync(int userId, string canvasJson, EntitlementsDto entitlements, CancellationToken ct = default)
    {
        // Limits apply to the user library, not per-canvas duplicates.
        await EnsureCanCreateDataSourceAsync(userId, entitlements, ct);
    }

    public async Task<int> CountLibraryDataSourcesAsync(int userId, CancellationToken ct = default)
        => await _db.DataSources.CountAsync(d => d.OwnerUserId == userId, ct);

    public async Task<int> CountCanvasDataSourcesAsync(int userId, CancellationToken ct = default)
        => await CountLibraryDataSourcesAsync(userId, ct);

    /// <summary>Count dataSources array entries inside editor canvas JSON.</summary>
    public static int CountSourcesInCanvasJson(string? canvasJson) => GraphJsonHelper.CountSources(canvasJson);

    private static int? ParseNullableInt(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value == "*")
            return null;
        return int.TryParse(value, out var n) ? n : null;
    }
}
