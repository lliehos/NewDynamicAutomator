using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using Morobot.Contracts.Auth;
using Morobot.Domain;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace Morobot.Infrastructure.Identity;

public class AuthService
{
    public const string CookieName = "da_access";
    private static readonly Regex UserNamePattern = new(@"^[a-zA-Z][a-zA-Z0-9_]{2,49}$", RegexOptions.Compiled);

    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly EntitlementService _entitlements;
    private readonly EventLogService _events;
    private readonly SystemSettingsService _settings;
    private readonly PasswordHasher<AppUser> _hasher = new();

    public AuthService(
        AppDbContext db,
        IConfiguration config,
        EntitlementService entitlements,
        EventLogService events,
        SystemSettingsService settings)
    {
        _db = db;
        _config = config;
        _entitlements = entitlements;
        _events = events;
        _settings = settings;
    }

    public async Task<(LoginResponse? ok, string? errorKey)> RegisterAsync(
        RegisterRequest request,
        string? ip = null,
        CancellationToken ct = default)
    {
        var userName = (request.UserName ?? "").Trim();
        var password = request.Password ?? "";

        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(password))
            return (null, "register.errorRequired");

        if (ReservedUserNames.IsReserved(userName))
            return (null, "register.errorReserved");

        if (!UserNamePattern.IsMatch(userName))
            return (null, "register.errorUserNameFormat");

        var registerPlan = await _settings.GetDefaultRegisterPlanAsync(ct);
        var (pwdOk, pwdErr) = PasswordPolicy.Validate(password, registerPlan);
        if (!pwdOk)
            return (null, pwdErr);

        if (!string.IsNullOrEmpty(request.ConfirmPassword)
            && !string.Equals(password, request.ConfirmPassword, StringComparison.Ordinal))
            return (null, "register.errorPasswordMismatch");

        if (await _db.Users.AnyAsync(u => u.UserName == userName, ct))
            return (null, "register.errorExists");

        var user = new AppUser
        {
            UserName = userName,
            FirstName = Trunc(request.FirstName, 50),
            LastName = Trunc(request.LastName, 50),
            Email = Trunc(request.Email, 120),
            IsActive = true,
            Role = UserRole.User,
            PlanId = registerPlan.Id,
            PreferredLanguage = "fa",
            CreatedAtUtc = DateTime.UtcNow
        };
        user.PasswordHash = _hasher.HashPassword(user, password);
        _db.Users.Add(user);
        await _db.SaveChangesAsync(ct);
        user.Plan = registerPlan;

        await _events.UpsertDeviceSessionAsync(user.Id, user.UserName, request.Device, ip, ct);
        await _events.LogAsync(
            "Audit", "Auth", "Register",
            $"Registered {registerPlan.Code} user: {user.UserName}",
            user.Id, user.UserName,
            fingerprintHash: EventLogService.NormalizeFingerprint(request.Device),
            ipAddress: ip,
            ct: ct);

        var entitlements = await _entitlements.ResolveForUserAsync(user, ct);
        var token = CreateToken(user, entitlements);
        return (new LoginResponse
        {
            Token = token,
            UserId = user.Id,
            UserName = user.UserName,
            DisplayName = FormatDisplayName(user),
            Role = user.Role.ToString(),
            Entitlements = entitlements
        }, null);
    }

    /// <summary>
    /// Upgrade to a plan with AllowSelfUpgrade. Password must satisfy the target plan policy.
    /// </summary>
    public async Task<(LoginResponse? ok, string? errorKey)> UpgradePlanAsync(
        int userId,
        UpgradePlanRequest request,
        string? ip = null,
        CancellationToken ct = default)
    {
        var targetCode = (request.TargetPlan ?? "").Trim();
        var plan = await _db.Plans.FirstOrDefaultAsync(
            p => p.Code == targetCode && p.IsActive && p.AllowSelfUpgrade, ct);
        if (plan is null)
            return (null, "plan.upgrade.errorTarget");

        var user = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || !user.IsActive)
            return (null, "plan.upgrade.errorAuth");

        var current = user.Plan;
        if (current is not null && string.Equals(current.Code, plan.Code, StringComparison.OrdinalIgnoreCase))
            return (null, "plan.upgrade.errorSame");
        if (current is not null
            && !PasswordPolicy.IsLocal(current.Code)
            && plan.SortOrder <= current.SortOrder)
            return (null, "plan.upgrade.errorDowngrade");

        var verify = _hasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword ?? "");
        if (verify == PasswordVerificationResult.Failed)
            return (null, "plan.upgrade.errorCurrentPassword");

        var newPwd = request.NewPassword ?? "";
        if (!string.IsNullOrEmpty(request.ConfirmPassword)
            && !string.Equals(newPwd, request.ConfirmPassword, StringComparison.Ordinal))
            return (null, "register.errorPasswordMismatch");

        var (pwdOk, pwdErr) = PasswordPolicy.Validate(newPwd, plan);
        if (!pwdOk)
            return (null, pwdErr);

        var fromCode = current?.Code ?? nameof(PlanCode.Local);
        user.PlanId = plan.Id;
        user.Plan = plan;
        user.PasswordHash = _hasher.HashPassword(user, newPwd);
        await _db.SaveChangesAsync(ct);

        await _events.LogAsync(
            "Audit", "Auth", "UpgradePlan",
            $"Upgraded {user.UserName} {fromCode} → {plan.Code} (password policy applied)",
            user.Id, user.UserName,
            ipAddress: ip,
            ct: ct);

        var entitlements = await _entitlements.ResolveForUserAsync(user, ct);
        var token = CreateToken(user, entitlements);
        return (new LoginResponse
        {
            Token = token,
            UserId = user.Id,
            UserName = user.UserName,
            DisplayName = FormatDisplayName(user),
            Role = user.Role.ToString(),
            Entitlements = entitlements
        }, null);
    }

    public Task<List<Plan>> ListSelfUpgradePlansAsync(CancellationToken ct = default) =>
        _db.Plans.AsNoTracking()
            .Where(p => p.IsActive && p.AllowSelfUpgrade)
            .OrderBy(p => p.SortOrder)
            .ToListAsync(ct);

    public async Task<(LoginResponse? ok, string? errorKey)> LoginAsync(LoginRequest request, string? ip = null, CancellationToken ct = default)
    {
        var user = await _db.Users
            .Include(u => u.Plan)
            .FirstOrDefaultAsync(u => u.UserName == request.UserName, ct);
        if (user is null || !user.IsActive)
            return (null, "login.errorInvalid");

        var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (result == PasswordVerificationResult.Failed)
            return (null, "login.errorInvalid");

        // One Local/guest identity per machine (blocks multi-browser guest hopping).
        if (user.Plan is not null && PasswordPolicy.IsLocal(user.Plan.Code))
        {
            var machine = EventLogService.NormalizeMachineFingerprint(request.Device);
            var existingLocalUserId = await _events.FindLocalUserIdByMachineAsync(machine, ct);
            if (existingLocalUserId is int otherId && otherId != user.Id)
                return (null, "login.errorGuestDeviceTaken");
        }

        await _events.UpsertDeviceSessionAsync(user.Id, user.UserName, request.Device, ip, ct);
        var entitlements = await _entitlements.ResolveForUserAsync(user, ct);
        var token = CreateToken(user, entitlements);
        await _events.LogAsync(
            "Audit", "Auth", "LoginServer",
            $"Server login: {user.UserName}",
            user.Id, user.UserName,
            fingerprintHash: EventLogService.NormalizeFingerprint(request.Device),
            ipAddress: ip, ct: ct);

        return (new LoginResponse
        {
            Token = token,
            UserId = user.Id,
            UserName = user.UserName,
            DisplayName = FormatDisplayName(user),
            Role = user.Role.ToString(),
            Entitlements = entitlements
        }, null);
    }

    private static string? Trunc(string? s, int max)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        return s.Length <= max ? s : s[..max];
    }

    /// <summary>
    /// Local/test login still creates a real Local-plan user on the server so tasks/sources
    /// and limits cannot be bypassed by editing localStorage.
    /// </summary>
    public async Task<LoginResponse> BeginLocalSessionAsync(
        string claimedUserName,
        DeviceFingerprintDto? device,
        string? ip = null,
        CancellationToken ct = default)
    {
        var claimed = string.IsNullOrWhiteSpace(claimedUserName) ? "test" : claimedUserName.Trim();
        var fp = EventLogService.NormalizeFingerprint(device);
        if (string.IsNullOrEmpty(fp))
            fp = "unknown";

        // Per-machine Local identity (machine fingerprint excludes browser UA).
        var storageName = $"local_{fp[..Math.Min(16, fp.Length)]}";
        var localPlan = await _db.Plans.FirstAsync(p => p.Code == nameof(PlanCode.Local), ct);

        var machine = EventLogService.NormalizeMachineFingerprint(device);
        var existingLocalUserId = await _events.FindLocalUserIdByMachineAsync(machine, ct);
        AppUser? user = null;
        if (existingLocalUserId is int eid)
            user = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == eid, ct);

        user ??= await _db.Users.Include(u => u.Plan)
            .FirstOrDefaultAsync(u => u.UserName == storageName, ct);
        if (user is null)
        {
            user = new AppUser
            {
                UserName = storageName,
                FirstName = claimed,
                LastName = "Local",
                IsActive = true,
                Role = UserRole.User,
                PlanId = localPlan.Id,
                CreatedAtUtc = DateTime.UtcNow
            };
            user.PasswordHash = _hasher.HashPassword(user, Guid.NewGuid().ToString("N"));
            _db.Users.Add(user);
            await _db.SaveChangesAsync(ct);
            user.Plan = localPlan;
        }
        else
        {
            user.FirstName = claimed;
            user.PlanId = localPlan.Id;
            user.IsActive = true;
            await _db.SaveChangesAsync(ct);
            user.Plan ??= localPlan;
        }

        await _events.UpsertDeviceSessionAsync(user.Id, claimed, device, ip, ct);
        var entitlements = await _entitlements.ResolveForUserAsync(user, ct);
        var token = CreateToken(user, entitlements);
        await _events.LogAsync(
            "Audit", "Auth", "LoginLocal",
            $"Local/test login claimed '{claimed}' as {storageName}",
            user.Id, storageName,
            detailsJson: System.Text.Json.JsonSerializer.Serialize(new { claimed, fingerprint = fp }),
            fingerprintHash: fp,
            ipAddress: ip,
            ct: ct);

        return new LoginResponse
        {
            Token = token,
            UserId = user.Id,
            UserName = claimed,
            DisplayName = claimed,
            Role = user.Role.ToString(),
            Entitlements = entitlements
        };
    }

    public string CreateToken(AppUser user, EntitlementsDto? entitlements = null)
    {
        entitlements ??= EntitlementService.LocalDefaults();
        var key = _config["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key missing");
        var issuer = _config["Jwt:Issuer"] ?? "Morobot";
        var audience = _config["Jwt:Audience"] ?? "Morobot";
        var hours = int.TryParse(_config["Jwt:ExpireHours"], out var h) ? h : 12;

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.UserName),
            new(JwtRegisteredClaimNames.UniqueName, user.UserName),
            new(ClaimTypes.Role, user.Role.ToString()),
            new(EntitlementService.ClaimRole, user.Role.ToString()),
            new(EntitlementService.ClaimPlan, entitlements.PlanCode),
            new(EntitlementService.ClaimIsLocal, entitlements.IsLocal ? "1" : "0"),
            new(EntitlementService.ClaimCanPlay, entitlements.CanPlay ? "1" : "0"),
            new(EntitlementService.ClaimCanSelector, entitlements.CanSelector ? "1" : "0"),
            new(EntitlementService.ClaimCanRecord, entitlements.CanRecord ? "1" : "0"),
            new(EntitlementService.ClaimCanSmart, entitlements.CanSmart ? "1" : "0"),
            new(EntitlementService.ClaimCanShare, entitlements.CanShare ? "1" : "0"),
            new(EntitlementService.ClaimMaxTasks, entitlements.MaxTasks?.ToString() ?? "*"),
            new(EntitlementService.ClaimMaxSources, entitlements.MaxDataSources?.ToString() ?? "*"),
            new(EntitlementService.ClaimMaxProcessSteps, entitlements.MaxProcessSteps?.ToString() ?? "*"),
            new("display_name", FormatDisplayName(user)),
            new("profile_complete", IsProfileComplete(user) ? "1" : "0")
        };
        if (!string.IsNullOrWhiteSpace(user.FirstName))
            claims.Add(new Claim(ClaimTypes.GivenName, user.FirstName));
        if (!string.IsNullOrWhiteSpace(user.LastName))
            claims.Add(new Claim(ClaimTypes.Surname, user.LastName));

        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        var jwt = new JwtSecurityToken(
            issuer,
            audience,
            claims,
            expires: DateTime.UtcNow.AddHours(hours),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }

    public async Task<AppUser?> GetUserAsync(int userId, CancellationToken ct = default)
        => await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);

    public static bool IsProfileComplete(AppUser user) =>
        !string.IsNullOrWhiteSpace(user.FirstName)
        && !string.IsNullOrWhiteSpace(user.LastName)
        && !string.IsNullOrWhiteSpace(user.Email)
        && !string.IsNullOrWhiteSpace(user.Mobile);

    public static string FormatDisplayName(AppUser user)
    {
        var full = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(full) ? user.UserName : full;
    }

    public async Task<(LoginResponse? result, string? errorKey)> UpdateProfileAsync(
        int userId, string? firstName, string? lastName, string? email, string? mobile, CancellationToken ct = default)
    {
        var user = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return (null, "settings.errorNotFound");

        firstName = Trunc(firstName?.Trim(), 50);
        lastName = Trunc(lastName?.Trim(), 50);
        email = Trunc(email?.Trim(), 120);
        mobile = Trunc(mobile?.Trim(), 30);

        if (string.IsNullOrWhiteSpace(firstName) || string.IsNullOrWhiteSpace(lastName)
            || string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(mobile))
            return (null, "settings.errorRequired");

        user.FirstName = firstName;
        user.LastName = lastName;
        user.Email = email;
        user.Mobile = mobile;
        await _db.SaveChangesAsync(ct);

        var entitlements = await _entitlements.ResolveForUserAsync(user, ct);
        var token = CreateToken(user, entitlements);
        return (new LoginResponse
        {
            Token = token,
            UserId = user.Id,
            UserName = user.UserName,
            DisplayName = FormatDisplayName(user),
            Role = user.Role.ToString(),
            Entitlements = entitlements
        }, null);
    }
}
