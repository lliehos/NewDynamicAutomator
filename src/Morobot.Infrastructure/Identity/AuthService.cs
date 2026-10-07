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

    /// <summary>
    /// Accepted user-name shapes. Two are allowed:
    /// <list type="bullet">
    /// <item>a national code — 8 to 10 digits, which is what the legacy system used as the account
    /// name and what users expect to type;</item>
    /// <item>an account name — 3 to 50 characters starting with a letter, then letters, digits,
    /// dot, dash or underscore.</item>
    /// </list>
    /// A name must be one or the other, never a mix: letting a code carry letters would make
    /// "national code or user name" ambiguous when routing a sign-in to the right provider.
    /// </summary>
    private static readonly Regex UserNamePattern =
        new(@"^(?:\d{8,10}|[a-zA-Z][a-zA-Z0-9._\-]{2,49})$", RegexOptions.Compiled);

    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly EntitlementService _entitlements;
    private readonly EventLogService _events;
    private readonly SystemSettingsService _settings;
    private readonly LicenseService _license;
    private readonly DeploymentBindingService _deploymentBinding;
    private readonly AuthModeResolver _authMode;
    private readonly ILdapAuthenticator _ldap;
    private readonly PasswordHasher<AppUser> _hasher = new();

    public AuthService(
        AppDbContext db,
        IConfiguration config,
        EntitlementService entitlements,
        EventLogService events,
        SystemSettingsService settings,
        LicenseService license,
        DeploymentBindingService deploymentBinding,
        AuthModeResolver authMode,
        ILdapAuthenticator ldap)
    {
        _db = db;
        _config = config;
        _entitlements = entitlements;
        _events = events;
        _settings = settings;
        _license = license;
        _deploymentBinding = deploymentBinding;
        _authMode = authMode;
        _ldap = ldap;
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

        // Without plan management there is no "default register plan" to honour: nobody can define
        // what a level means on that install, so the account starts on the deployment's top plan and
        // the deployment-wide password policy is what governs — the plan's own rule is unreachable
        // from any page and would otherwise override a setting the admin *can* edit.
        var allowsPlans = await _entitlements.AllowsPlanManagementAsync(ct);
        Plan registerPlan;
        if (allowsPlans)
        {
            registerPlan = await _settings.GetDefaultRegisterPlanAsync(ct);
        }
        else
        {
            registerPlan = await _entitlements.FindTopPlanAsync(ct)
                           ?? await _settings.GetDefaultRegisterPlanAsync(ct);
        }

        // When plans are managed, the plan's own rules win; otherwise the global policy is the rule.
        var (globalMinLen, globalComplexity) = await _settings.GetGlobalPasswordPolicyAsync(ct);
        var (pwdOk, pwdErr) = PasswordPolicy.Validate(
            password, allowsPlans ? registerPlan : null, globalMinLen, globalComplexity);
        if (!pwdOk)
            return (null, pwdErr);

        if (!string.IsNullOrEmpty(request.ConfirmPassword)
            && !string.Equals(password, request.ConfirmPassword, StringComparison.Ordinal))
            return (null, "register.errorPasswordMismatch");

        if (await _db.Users.AnyAsync(u => u.UserName == userName, ct))
            return (null, "register.errorExists");

        try
        {
            await _license.EnsureCanAddActiveUserAsync(ct);
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("license.error.", StringComparison.Ordinal))
        {
            return (null, ex.Message.Split(':')[0]);
        }

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
        await _deploymentBinding.StampUserAsync(user, ct);
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
        // Self-upgrade is a plan operation, so it means nothing on an install that cannot manage
        // plans. Refused here as well as in the page, because the POST is reachable on its own.
        if (!await _entitlements.AllowsPlanManagementAsync(ct))
            return (null, "plan.upgrade.errorUnavailable");

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

        var (globalMinLen, globalComplexity) = await _settings.GetGlobalPasswordPolicyAsync(ct);
        var (pwdOk, pwdErr) = PasswordPolicy.Validate(newPwd, plan, globalMinLen, globalComplexity);
        if (!pwdOk)
            return (null, pwdErr);

        var fromCode = current?.Code ?? nameof(PlanCode.Local);
        user.PlanId = plan.Id;
        user.Plan = plan;
        user.PasswordHash = _hasher.HashPassword(user, newPwd);
        // The user just chose a password that satisfies this very plan, so nothing is pending any more.
        user.PasswordChangeRequired = false;
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

    /// <summary>
    /// Put a user on a plan WITHOUT asking for a password, for a plan they have PAID for.
    /// </summary>
    /// <remarks>
    /// Distinct from <see cref="UpgradePlanAsync"/> on purpose. That flow asks for the current
    /// password because it is a self-service switch made on the strength of being signed in; here the
    /// entitlement comes from a completed payment, and demanding a password after taking someone's
    /// money would be an obstacle invented at the worst moment. The password policy still applies at
    /// the next password change, so the plan's rules are not bypassed — only the re-entry is.
    /// </remarks>
    public async Task AssignPlanAsync(int userId, int planId, string? ip = null, CancellationToken ct = default)
    {
        var user = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct)
            ?? throw new InvalidOperationException("کاربر پیدا نشد.");
        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == planId, ct)
            ?? throw new InvalidOperationException("پلن پیدا نشد.");

        var fromPlan = user.Plan;
        var fromCode = fromPlan?.Code ?? nameof(PlanCode.Local);
        user.PlanId = plan.Id;
        user.Plan = plan;
        // The current password's plaintext is not available here, so we cannot re-validate it against
        // the new plan's policy. Rather than guess, a move onto a plan with a STRICTER policy asks
        // for a change at the next sign-in; a same-or-looser policy leaves the flag alone. That is the
        // honest behaviour: we do not claim the password is fine, and we do not force a change it may
        // not need.
        var (globalMinLen, globalComplexity) = await _settings.GetGlobalPasswordPolicyAsync(ct);
        var (minLen, complexity) = PasswordPolicy.Resolve(plan, globalMinLen, globalComplexity);
        var stricter = minLen > (fromPlan?.MinPasswordLength ?? 0)
                       || (complexity && !(fromPlan?.RequireLetterAndDigit ?? false));
        if (stricter) user.PasswordChangeRequired = true;
        await _db.SaveChangesAsync(ct);

        await _events.LogAsync(
            "Audit", "Auth", "PlanPurchased",
            $"Activated {plan.Code} for {user.UserName} (was {fromCode}) after payment",
            user.Id, user.UserName,
            ipAddress: ip,
            ct: ct);
    }

    public async Task<List<Plan>> ListSelfUpgradePlansAsync(CancellationToken ct = default)
    {        // Empty when the licence has no plan management: the page then shows its built-in
        // "no plans available" note instead of offering levels nobody can define.
        if (!await _entitlements.AllowsPlanManagementAsync(ct))
            return new List<Plan>();

        return await _db.Plans.AsNoTracking()
            .Where(p => p.IsActive && p.AllowSelfUpgrade)
            .OrderBy(p => p.SortOrder)
            .ToListAsync(ct);
    }

    /// <summary>
    /// Create the local row for a directory user signing in for the first time.
    /// </summary>
    /// <remarks>
    /// The account is created with:
    /// <list type="bullet">
    /// <item>no usable password — a random hash, never revealed, because the directory owns the
    ///       credential. Only the Admin break-glass path ever consults a local hash, and this is not
    ///       an Admin, so the random value can never be matched.</item>
    /// <item>the Local plan — the safe no-entitlement default — when the licence manages plans, so an
    ///       unconfigured new user cannot accidentally receive paid entitlements. Without plan
    ///       management there is no such default to hold anyone below, so the account starts on the
    ///       deployment's top plan, exactly as a self-registered one does.</item>
    /// <item>an empty profile, which is what sends them to the completion page on the next
    ///       request.</item>
    /// </list>
    /// Returns null when the user name cannot be used (for example a name reserved by the system).
    /// </remarks>
    private async Task<AppUser?> ProvisionLdapUserAsync(string? requestedName, string? ip, CancellationToken ct)
    {
        var name = (requestedName ?? "").Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 100)
            return null;
        if (ReservedUserNames.IsReserved(name))
        {
            await _events.LogAsync("Warning", "Auth", "LdapProvisionRefused",
                "Directory sign-in refused: the user name is reserved.", null, name, ipAddress: ip, ct: ct);
            return null;
        }
        // A concurrent first sign-in could have created it already; re-read before inserting.
        var existing = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.UserName == name, ct);
        if (existing is not null) return existing;

        var startingPlan = await _entitlements.AllowsPlanManagementAsync(ct)
            ? await _db.Plans.FirstOrDefaultAsync(p => p.Code == nameof(PlanCode.Local), ct)
            : await _entitlements.FindTopPlanAsync(ct);
        var user = new AppUser
        {
            UserName = name,
            FirstName = null,
            LastName = null,
            IsActive = true,
            Role = UserRole.User,
            PlanId = startingPlan?.Id,
            Plan = startingPlan,
            CreatedAtUtc = DateTime.UtcNow,
            PreferredLanguage = "fa"
        };
        // Random, discardable: the directory is the password authority for this account.
        user.PasswordHash = _hasher.HashPassword(user, Guid.NewGuid().ToString("N") + "Aa1!");
        _db.Users.Add(user);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Lost a race with a simultaneous first login — use the row the other request created.
            _db.Entry(user).State = EntityState.Detached;
            return await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.UserName == name, ct);
        }

        await _events.LogAsync("Audit", "Auth", "LdapUserProvisioned",
            $"Directory user {name} was provisioned on first sign-in (profile incomplete).",
            user.Id, user.UserName, ipAddress: ip, ct: ct);
        return user;
    }

    public async Task<(LoginResponse? ok, string? errorKey)> LoginAsync(LoginRequest request, string? ip = null, CancellationToken ct = default)
    {
        var user = await _db.Users
            .Include(u => u.Plan)
            .FirstOrDefaultAsync(u => u.UserName == request.UserName, ct);

        // The directory, when configured, decides whether the password is right. The local row is
        // still consulted first because it supplies the role and plan: a user the directory accepts
        // but that has no row here would have no permissions, so the lookup must happen either way.
        //
        // Which provider is asked is resolved per user, not once for the whole install: with both
        // switches on, a national code belongs to the local table and a directory account name
        // belongs to the directory, and the same form has to serve both.
        var providers = await _authMode.GetProvidersAsync(ct);
        var mode = providers.ResolveFor(request.UserName);
        var password = request.Password ?? "";
        if (mode == AuthMode.Ldap && user is { IsActive: true, Role: UserRole.Admin }
            && !string.IsNullOrEmpty(password)
            && _hasher.VerifyHashedPassword(user, user.PasswordHash, password)
               != PasswordVerificationResult.Failed)
        {
            // Break-glass path, and the reason it is safe: switching to a directory must not be able
            // to lock the administrator out of the very page that switches back. The local password
            // of an Admin is therefore always honoured. It is bounded to the Admin role — ordinary
            // accounts get no such bypass — and the bypass is logged so a use of it is visible.
            //
            // Only meaningful when the local provider is off: with it on, a numeric or unknown name
            // already resolves to Local and this branch is never reached for an administrator.
            await _events.LogAsync("Warning", "Auth", "LoginAdminLocalFallback",
                $"Administrator {user.UserName} signed in with the local password while the directory is the only method.",
                user.Id, user.UserName, ipAddress: ip, ct: ct);
        }
        else if (mode == AuthMode.Ldap)
        {
            var options = await _authMode.GetLdapOptionsAsync(ct);
            if (!options.IsUsable)
            {
                // Directory sign-in was selected but not configured. Refusing here is the safe
                // reading: falling back to local passwords for everyone would silently accept
                // credentials the administrator believes are no longer valid.
                await _events.LogAsync("Error", "Auth", "LdapMisconfigured",
                    "Sign-in rejected: LDAP mode is active but the directory settings are incomplete.",
                    user?.Id, user?.UserName, ipAddress: ip, ct: ct);
                return (null, "login.errorLdapMisconfigured");
            }

            // The bind must happen BEFORE anything is written. Provisioning first would leave a
            // stray account behind on every mistyped password, which an attacker could use to fill
            // the user table. The directory also needs no local row to validate credentials.
            var ldapResult = await _ldap.AuthenticateAsync(options, request.UserName, password, ct);
            if (ldapResult == LdapAuthResult.Unavailable)
                return (null, "login.errorLdapUnavailable");
            if (ldapResult != LdapAuthResult.Success)
                return (null, "login.errorInvalid");

            if (user is null)
            {
                // First directory sign-in for this account. The directory has now proved the
                // password, so the local row is created here without one — there is nothing to
                // store, and LDAP remains the only credential source for this account. The row
                // starts with an empty profile, which sends the user to the completion page on the
                // next request (RequireProfileCompleteFilter).
                var provisioned = await ProvisionLdapUserAsync(request.UserName, ip, ct);
                if (provisioned is null)
                    return (null, "login.errorInvalid");
                user = provisioned;
            }
            if (!user.IsActive)
                return (null, "login.errorInvalid");

            await _events.LogAsync("Audit", "Auth", "LoginLdap",
                $"Directory login: {user.UserName}",
                user.Id, user.UserName, ipAddress: ip, ct: ct);
        }
        else
        {
            if (user is null || !user.IsActive)
                return (null, "login.errorInvalid");

            var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, password);
            if (result == PasswordVerificationResult.Failed)
                return (null, "login.errorInvalid");
        }

        if (!await _deploymentBinding.IsUserUsableAsync(user!, ct))
            return (null, "login.errorDeploymentBinding");

        // One Local/guest identity per machine (blocks multi-browser guest hopping).
        if (user!.Plan is not null && PasswordPolicy.IsLocal(user.Plan.Code))
        {
            var machine = EventLogService.NormalizeMachineFingerprint(request.Device);
            var existingLocalUserId = await _events.FindLocalUserIdByMachineAsync(machine, ct);
            if (existingLocalUserId is int otherId && otherId != user.Id)
                return (null, "login.errorGuestDeviceTaken");
        }

        await _events.UpsertDeviceSessionAsync(user.Id, user.UserName, request.Device, ip, ct);

        // Single-session deployments hold each account to one live sign-in, which is what stops a
        // purchased seat being shared around an office. Bumping the stored version invalidates every
        // token issued before this moment, so the sign-in that just happened wins and the other
        // machine is signed out on its next request. Only done here, on a successful password/LDAP
        // verification — never on a failed attempt, which must not be able to log anyone out.
        if (await EnforcesSingleSessionAsync(ct))
        {
            user.SessionVersion += 1;
            await _db.SaveChangesAsync(ct);
        }

        var entitlements = await _entitlements.ResolveForUserAsync(user, ct);
        var token = CreateToken(user, entitlements);
        if (mode != AuthMode.Ldap)
        {
            await _events.LogAsync(
                "Audit", "Auth", "LoginServer",
                $"Server login: {user.UserName}",
                user.Id, user.UserName,
                fingerprintHash: EventLogService.NormalizeFingerprint(request.Device),
                ipAddress: ip, ct: ct);
        }

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
    /// Whether this deployment holds each account to a single live session.
    /// </summary>
    /// <remarks>
    /// Read from the licence, not from a setting: it protects the revenue model, so a deployment's
    /// administrator should not be able to switch it off. A licence read failure resolves to false,
    /// because failing to read the licence must not start logging people out of a deployment that
    /// never sold anything.
    /// </remarks>
    private async Task<bool> EnforcesSingleSessionAsync(CancellationToken ct = default)
    {
        try
        {
            return (await _license.GetRuntimeStateAsync(ct)).EnforcesSingleSession;
        }
        catch
        {
            return false;
        }
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
            await _deploymentBinding.StampUserAsync(user, ct);
            _db.Users.Add(user);
            await _db.SaveChangesAsync(ct);
            user.Plan = localPlan;
        }
        else
        {
            if (!await _deploymentBinding.IsUserUsableAsync(user, ct))
                return new LoginResponse { Token = string.Empty, UserId = 0, UserName = string.Empty };
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
            // Carried in the token so the layout can render the avatar without an
            // extra per-request user query. Refreshed whenever the token is reissued.
            new("avatar_path", user.AvatarPath ?? ""),
            new("profile_complete", IsProfileComplete(user) ? "1" : "0"),
            // Read by the panel gate: a pending password change must be finished before the rest of
            // the panel opens. Lives in the token so the gate costs no query per request.
            new("password_change_required", user.PasswordChangeRequired ? "1" : "0"),
            // The single-session check compares this against the user row, so a superseded token is
            // rejected without an extra table. Carried in the token for the same reason as the
            // password flag: the check must not cost a query on every request.
            new("session_version", user.SessionVersion.ToString())
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

    /// <summary>
    /// Set (or clear, with <c>null</c>) the user's avatar path, returning a freshly
    /// minted token because `avatar_path` lives in the cookie claims. Kept separate
    /// from UpdateProfileAsync because the profile form requires all four fields and
    /// the avatar must be changeable on its own.
    /// </summary>
    public async Task<string?> SetAvatarPathAsync(int userId, string? avatarPath, CancellationToken ct = default)
    {
        var user = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return null;
        user.AvatarPath = string.IsNullOrWhiteSpace(avatarPath) ? null : Trunc(avatarPath.Trim(), 260);
        await _db.SaveChangesAsync(ct);

        var entitlements = await _entitlements.ResolveForUserAsync(user, ct);
        return CreateToken(user, entitlements);
    }

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

    /// <summary>
    /// The password rules that apply to a user's own password, plus whether this account may change
    /// its password here at all. The panel uses it to guard the input length and to hide the form for
    /// accounts whose credential the directory owns.
    /// </summary>
    public async Task<(int minLength, bool requireLetterAndDigit, bool directoryManaged)> GetPasswordPolicyAsync(
        int userId, CancellationToken ct = default)
    {
        var user = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct);
        var (globalMinLen, globalComplexity) = await _settings.GetGlobalPasswordPolicyAsync(ct);
        var allowsPlans = await _entitlements.AllowsPlanManagementAsync(ct);
        var (min, complexity) = PasswordPolicy.Resolve(
            allowsPlans ? user?.Plan : null, globalMinLen, globalComplexity);
        var directoryManaged = user is not null && await IsDirectoryManagedAsync(user, ct);
        return (min, complexity, directoryManaged);
    }

    /// <summary>
    /// Change the signed-in user's own password. The current password must be supplied and verified
    /// first so a stolen session alone cannot lock the owner out, and the new one must satisfy the
    /// same effective policy the account is held to everywhere else.
    /// </summary>
    /// <returns>
    /// A freshly minted token on success — the password-change flag lives in the cookie claims, so
    /// the gate has to be released by reissuing it — or an error key.
    /// </returns>
    public async Task<(bool ok, string? errorKey, string? token)> ChangePasswordAsync(
        int userId,
        string? currentPassword,
        string? newPassword,
        string? confirmPassword,
        string? ip = null,
        CancellationToken ct = default)
    {
        var user = await _db.Users.Include(u => u.Plan).FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return (false, "settings.errorNotFound", null);

        // A directory-owned account has no local credential to change; writing one would only create
        // a password the directory never sees. The Admin break-glass row is the exception, because its
        // local password is exactly what lets an administrator back in when the directory is down.
        if (await IsDirectoryManagedAsync(user, ct))
            return (false, "password.errorDirectoryManaged", null);

        var verify = _hasher.VerifyHashedPassword(user, user.PasswordHash, currentPassword ?? "");
        if (verify == PasswordVerificationResult.Failed)
            return (false, "password.errorCurrent", null);

        if (string.IsNullOrEmpty(newPassword))
            return (false, "password.errorRequired", null);

        if (string.Equals(newPassword, currentPassword, StringComparison.Ordinal))
            return (false, "password.errorSameAsCurrent", null);

        if (!string.Equals(newPassword, confirmPassword ?? "", StringComparison.Ordinal))
            return (false, "register.errorPasswordMismatch", null);

        var (globalMinLen, globalComplexity) = await _settings.GetGlobalPasswordPolicyAsync(ct);
        var allowsPlans = await _entitlements.AllowsPlanManagementAsync(ct);
        var (pwdOk, pwdErr) = PasswordPolicy.Validate(
            newPassword, allowsPlans ? user.Plan : null, globalMinLen, globalComplexity);
        if (!pwdOk)
            return (false, pwdErr, null);

        user.PasswordHash = _hasher.HashPassword(user, newPassword);
        // Whatever a plan move asked for is satisfied now.
        user.PasswordChangeRequired = false;
        await _db.SaveChangesAsync(ct);

        await _events.LogAsync(
            "Audit", "Auth", "ChangePassword",
            $"Password changed for: {user.UserName}",
            user.Id, user.UserName,
            ipAddress: ip,
            ct: ct);

        var entitlements = await _entitlements.ResolveForUserAsync(user, ct);
        return (true, null, CreateToken(user, entitlements));
    }

    /// <summary>
    /// True when the account's credentials live in the directory rather than in the local table. The
    /// Admin row is never treated as directory-owned: its local password is the documented
    /// break-glass path, so an administrator must remain able to change it.
    /// </summary>
    public async Task<bool> IsDirectoryManagedAsync(AppUser user, CancellationToken ct = default)
    {
        if (user.Role == UserRole.Admin) return false;
        var providers = await _authMode.GetProvidersAsync(ct);
        return providers.ResolveFor(user.UserName) == AuthMode.Ldap;
    }

    /// <summary>Id-based overload for callers holding only the signed-in id (the panel gate).</summary>
    public async Task<bool> IsDirectoryManagedAsync(int userId, CancellationToken ct = default)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
        return user is not null && await IsDirectoryManagedAsync(user, ct);
    }
}
