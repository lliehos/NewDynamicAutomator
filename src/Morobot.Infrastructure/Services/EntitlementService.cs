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

        // An install whose licence has no plan management has no levels to be on: every user gets
        // the top plan. This also covers a TRIAL, which is deliberately plan-less.
        //
        // Applying it here rather than at each call site is the point — entitlements are read from
        // this one method (and FromClaims for the cookie path), so flattening in the resolver means
        // the caps, the feature flags and the "my plan" display all agree without every caller
        // having to remember the rule.
        plan = await FlattenToTopPlanAsync(plan, ct);

        return await ApplyLicenseCeilingAsync(FromPlan(plan, user.PlanExpiresAtUtc), ct);
    }

    /// <summary>
    /// The plan a user is effectively on. When the licence grants plan management this is the plan
    /// they were assigned; when it does not (and during a trial) it is the deployment's top plan, so
    /// no user is ever held below a level the install cannot express.
    /// </summary>
    /// <remarks>
    /// The top plan is the active plan with the GREATEST capability, chosen by sort order first and
    /// then by "unlimited beats limited". Sort order is the admin's own statement of which plan is
    /// highest, and falling back to a capability comparison keeps the rule sane on an install whose
    /// sort orders are all equal (the seeded default) rather than silently picking plan #1.
    /// </remarks>
    public async Task<Plan> FlattenToTopPlanAsync(Plan plan, CancellationToken ct = default)
    {
        if (await AllowsPlanManagementAsync(ct))
            return plan;

        // A Local account is not a level, it is the deliberate no-play account used for testing and
        // for a device that must not drive a browser (see LocalDefaults: CanPlay = false). Promoting
        // it to the top plan would hand those accounts the very capability the plan exists to deny,
        // so it is left exactly as assigned.
        if (PasswordPolicy.IsLocal(plan.Code))
            return plan;

        var top = await FindTopPlanAsync(ct);

        // Only ever RAISE a level. If the install somehow has no usable top plan, the user keeps
        // what they had rather than being silently dropped to nothing.
        return top is not null && top.SortOrder > plan.SortOrder ? top : plan;
    }

    /// <summary>
    /// The deployment's top plan: the active, non-Local plan with the greatest capability. Null when
    /// the install has no such plan to offer.
    /// </summary>
    /// <remarks>
    /// Sort order is the admin's own statement of which plan is highest, and falling back to a
    /// capability comparison keeps the rule sane on an install whose sort orders are all equal (the
    /// seeded default) rather than silently picking plan #1. Local is excluded on purpose: it is the
    /// no-play account, not a level (see <see cref="FlattenToTopPlanAsync"/>).
    /// <para>
    /// This is the plan a plan-less install puts its users on, so the row stored for a new account
    /// says the same thing the resolver would answer for it.
    /// </para>
    /// </remarks>
    public Task<Plan?> FindTopPlanAsync(CancellationToken ct = default) =>
        _db.Plans.AsNoTracking()
            .Where(p => p.IsActive && p.Code != nameof(PlanCode.Local))
            .OrderByDescending(p => p.SortOrder)
            // Prefer the plan that grants the most: unlimited caps rank above numeric ones, and the
            // capability switches break a remaining tie. Ordering is done in SQL as far as the
            // columns allow.
            .ThenByDescending(p => p.MaxTasks == null ? 1 : 0)
            .ThenByDescending(p => p.MaxDataSources == null ? 1 : 0)
            .ThenByDescending(p => p.CanSmart)
            .ThenByDescending(p => p.CanRecord)
            .ThenByDescending(p => p.CanPlay)
            .FirstOrDefaultAsync(ct);

    /// <summary>True when this licence lets the deployment manage user plan levels.</summary>
    public async Task<bool> AllowsPlanManagementAsync(CancellationToken ct = default)
    {
        try
        {
            var runtime = await _licenses.GetRuntimeStateAsync(ct);
            return runtime.AllowsPlanManagement;
        }
        catch
        {
            // A licence that cannot be read is not a reason to strip capabilities from every user;
            // the licence layer already has its own restricted mode for that.
            return true;
        }
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
            ? await FlattenClaimsAsync(fromClaims, ct)
            : await ResolveForUserAsync(dbUser, ct);

        // TaskCount drives the "N / cap" readouts and, like the cap check, must count the processes
        // the user OWNS. It used to count ProcessShares rows (processes shared WITH the user), so a
        // page could show a full quota for someone who owned nothing and an empty one for someone
        // at the cap.
        entitlements.TaskCount = await CountOwnedProcessesAsync(userId, ct);
        entitlements.DataSourceCount = await CountCanvasDataSourcesAsync(userId, ct);
        return entitlements;
    }

    /// <summary>
    /// Brings an entitlements object built from the auth cookie up to the flattened level.
    /// </summary>
    /// <remarks>
    /// <see cref="FromClaims"/> cannot flatten by itself: it is static and has no database, and the
    /// plan cookie is only rewritten when the user signs in or changes plan. Without this, a user
    /// holding a cookie issued before the licence changed would keep reporting the old (lower) level
    /// from every page that reads the cookie, even though the server would allow the top level.
    /// </remarks>
    private async Task<EntitlementsDto> FlattenClaimsAsync(EntitlementsDto entitlements, CancellationToken ct)
    {
        if (await AllowsPlanManagementAsync(ct))
            return await ApplyLicenseCeilingAsync(entitlements, ct);

        var plan = await _db.Plans.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Code == entitlements.PlanCode, ct);
        if (plan is null)
            return await ApplyLicenseCeilingAsync(entitlements, ct);

        var flattened = await FlattenToTopPlanAsync(plan, ct);
        if (ReferenceEquals(flattened, plan) || flattened.Code == plan.Code)
            return await ApplyLicenseCeilingAsync(entitlements, ct);

        var upgraded = FromPlan(flattened, entitlements.PlanExpiresAtUtc);
        upgraded.TaskCount = entitlements.TaskCount;
        upgraded.DataSourceCount = entitlements.DataSourceCount;
        return await ApplyLicenseCeilingAsync(upgraded, ct);
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
        var count = await CountOwnedProcessesAsync(userId, ct);
        if (count >= entitlements.MaxTasks.Value)
            throw new InvalidOperationException($"Task limit reached ({entitlements.MaxTasks}).");
    }

    /// <summary>
    /// The number of processes a user OWNS — the quantity <see cref="EntitlementsDto.MaxTasks"/>
    /// caps.
    /// </summary>
    /// <remarks>
    /// This counted <c>ProcessShares</c> rows for the user, i.e. the processes SHARED WITH them,
    /// which is a different set entirely. On a tier that has sharing on but owns nothing (or the
    /// reverse) the cap was tested against the wrong number: a user with three shared processes and
    /// no owned ones was blocked from creating their first, and a user with many owned processes and
    /// no shares could create past the cap. Ownership is <c>CreatorUserId</c>, the same test every
    /// other ownership check in this codebase uses.
    /// </remarks>
    public async Task<int> CountOwnedProcessesAsync(int userId, CancellationToken ct = default)
        => await _db.Processes.CountAsync(p => p.CreatorUserId == userId, ct);

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
