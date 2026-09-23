using Morobot.Contracts.Auth;
using Morobot.Contracts.Tasks;
using Morobot.Domain;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Services;

public class TaskShareService
{
    private readonly AppDbContext _db;
    private readonly EntitlementService _entitlements;

    public TaskShareService(AppDbContext db, EntitlementService entitlements)
    {
        _db = db;
        _entitlements = entitlements;
    }

    public async Task<List<UserSearchHitDto>> SearchUsersAsync(int requesterId, string? query, int take = 20, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 50);
        var q = (query ?? "").Trim();
        if (q.Length < 1)
            return new List<UserSearchHitDto>();

        var localCode = nameof(PlanCode.Local);
        var users = await _db.Users.AsNoTracking()
            .Include(u => u.Plan)
            .Where(u => u.IsActive && u.Id != requesterId)
            .Where(u => u.Plan == null || (u.Plan.Code != localCode && u.Plan.CanReceiveShare))
            .Where(u =>
                u.UserName.Contains(q)
                || (u.FirstName != null && u.FirstName.Contains(q))
                || (u.LastName != null && u.LastName.Contains(q))
                || (u.Email != null && u.Email.Contains(q))
                || (u.NationalId != null && u.NationalId.Contains(q))
                || ((u.FirstName ?? "") + " " + (u.LastName ?? "")).Contains(q))
            .OrderBy(u => u.UserName)
            .Take(take)
            .Select(u => new UserSearchHitDto
            {
                UserId = u.Id,
                UserName = u.UserName,
                FirstName = u.FirstName,
                LastName = u.LastName,
                DisplayName = ((u.FirstName ?? "") + " " + (u.LastName ?? "")).Trim(),
                Email = u.Email,
                NationalId = u.NationalId
            })
            .ToListAsync(ct);

        return users;
    }

    public async Task<(List<TaskShareDto>? list, string? error)> ListSharesAsync(int userId, int taskId, CancellationToken ct = default)
    {
        if (!await CanManageSharesAsync(userId, taskId, ct))
            return (null, "forbidden");

        var rows = await _db.ProcessShares.AsNoTracking()
            .Include(a => a.User)
            .Where(a => a.ProcessId == taskId)
            .ToListAsync(ct);

        var process = await _db.Processes.AsNoTracking().FirstAsync(t => t.Id == taskId, ct);
        var list = rows
            .OrderByDescending(a => a.UserId == process.CreatorUserId)
            .ThenBy(a => a.User?.UserName)
            .Select(a => MapShare(a, process.CreatorUserId))
            .ToList();
        return (list, null);
    }

    public async Task<(TaskShareDto? dto, string? error)> UpsertShareAsync(
        int actorId, int taskId, UpsertTaskShareRequest req, CancellationToken ct = default)
    {
        if (req.UserId <= 0 || req.UserId == actorId)
            return (null, "invalid_user");

        var process = await _db.Processes.Include(t => t.Shares).FirstOrDefaultAsync(t => t.Id == taskId, ct);
        if (process is null) return (null, "notfound");
        if (!await CanManageSharesAsync(actorId, taskId, ct))
            return (null, "forbidden");

        var actor = await _db.Users.Include(u => u.Plan).FirstAsync(u => u.Id == actorId, ct);
        var entitlements = await _entitlements.ResolveForUserAsync(actor, ct);
        if (!entitlements.CanShare || entitlements.IsLocal)
            return (null, "plan_no_share");

        if (process.CreatorUserId == req.UserId)
            return (null, "cannot_change_owner");

        var target = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == req.UserId && u.IsActive, ct);
        if (target is null) return (null, "user_not_found");
        if (target.Plan is not null && PasswordPolicy.IsLocal(target.Plan.Code))
            return (null, "cannot_share_to_guest");
        if (target.Plan is not null && !target.Plan.CanReceiveShare)
            return (null, "plan_cannot_receive");

        var (view, edit, delete, exec, ds) = ClampGrants(req, entitlements);
        if (!view && !edit && !delete && !exec && !ds)
            return (null, "no_permissions");

        var access = process.Shares.FirstOrDefault(a => a.UserId == req.UserId);
        var isNew = access is null;
        if (isNew)
        {
            if (entitlements.MaxSharesPerTask is int max)
            {
                var others = process.Shares.Count(a => a.UserId != process.CreatorUserId);
                if (others >= max)
                    return (null, "share_limit");
            }
            access = new ProcessShare { UserId = req.UserId, ProcessId = taskId };
            _db.ProcessShares.Add(access);
        }

        access!.CanView = view;
        access.CanEdit = edit;
        access.CanDelete = delete;
        access.CanExecute = exec;
        access.CanChangeDataSource = ds;
        access.GrantedAtUtc = DateTime.UtcNow;
        access.GrantedByUserId = actorId;
        await _db.SaveChangesAsync(ct);

        access.User = target;
        return (MapShare(access, process.CreatorUserId), null);
    }

    public async Task<(bool ok, string? error)> RevokeShareAsync(int actorId, int taskId, int targetUserId, CancellationToken ct = default)
    {
        if (!await CanManageSharesAsync(actorId, taskId, ct))
            return (false, "forbidden");

        var process = await _db.Processes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == taskId, ct);
        if (process is null) return (false, "notfound");
        if (process.CreatorUserId == targetUserId)
            return (false, "cannot_revoke_owner");

        var access = await _db.ProcessShares.FirstOrDefaultAsync(a => a.ProcessId == taskId && a.UserId == targetUserId, ct);
        if (access is null) return (false, "notfound");
        _db.ProcessShares.Remove(access);
        await _db.SaveChangesAsync(ct);
        return (true, null);
    }

    public async Task<bool> CanManageSharesAsync(int userId, int taskId, CancellationToken ct = default)
    {
        var process = await _db.Processes.AsNoTracking().FirstOrDefaultAsync(t => t.Id == taskId, ct);
        if (process is null) return false;
        if (process.CreatorUserId == userId) return true;
        return await _db.ProcessShares.AnyAsync(a =>
            a.UserId == userId && a.ProcessId == taskId && a.CanEdit, ct);
    }

    private static (bool view, bool edit, bool delete, bool exec, bool ds) ClampGrants(
        UpsertTaskShareRequest req, EntitlementsDto plan)
    {
        var view = req.CanView && plan.ShareAllowView;
        var edit = req.CanEdit && plan.ShareAllowEdit;
        var delete = req.CanDelete && plan.ShareAllowDelete;
        var exec = req.CanExecute && plan.ShareAllowExecute;
        var ds = req.CanChangeDataSource && plan.ShareAllowChangeDataSource;
        if (edit || delete || ds) view = true;
        return (view, edit, delete, exec, ds);
    }

    private static TaskShareDto MapShare(ProcessShare a, int? creatorId) => new()
    {
        UserId = a.UserId,
        UserName = a.User?.UserName ?? "",
        DisplayName = $"{a.User?.FirstName} {a.User?.LastName}".Trim(),
        Email = a.User?.Email,
        NationalId = a.User?.NationalId,
        CanView = a.CanView || a.CanEdit,
        CanEdit = a.CanEdit,
        CanDelete = a.CanDelete,
        CanExecute = a.CanExecute,
        CanChangeDataSource = a.CanChangeDataSource,
        IsOwner = creatorId == a.UserId,
        GrantedAtUtc = a.GrantedAtUtc
    };
}
