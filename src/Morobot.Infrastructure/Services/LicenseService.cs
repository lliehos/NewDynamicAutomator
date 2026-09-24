using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Morobot.Contracts.Licensing;
using Morobot.Domain;
using Morobot.Domain.Entities;
using Morobot.Infrastructure.Options;
using Morobot.Infrastructure.Persistence;
using Morobot.Licensing;

namespace Morobot.Infrastructure.Services;

public sealed class LicenseService
{
    private const string CacheKeyValidation = "license:validation";
    private const string CacheKeyRuntime = "license:runtime";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(1);

    private readonly AppDbContext _db;
    private readonly MorobotOptions _options;
    private readonly SystemSettingsService _settings;
    private readonly IMemoryCache _cache;
    private readonly ILicenseRequestHostAccessor _hostAccessor;
    private readonly string _publicKeyPem;

    public LicenseService(
        AppDbContext db,
        IOptions<MorobotOptions> options,
        SystemSettingsService settings,
        IMemoryCache cache,
        ILicenseRequestHostAccessor? hostAccessor = null)
    {
        _db = db;
        _options = options.Value;
        _settings = settings;
        _cache = cache;
        _hostAccessor = hostAccessor ?? new NullLicenseRequestHostAccessor();
        _publicKeyPem = string.IsNullOrWhiteSpace(_options.LicensePublicKeyPem)
            ? LicensePublicKeys.Active
            : _options.LicensePublicKeyPem;
    }

    public bool IsLicensingEnabled => _options.IsLicensingEnabled;

    public async Task<DeploymentAnchor> EnsureAnchorAsync(CancellationToken ct = default)
    {
        var (anchor, _) = await EnsureDeploymentAsync(ct);
        return anchor;
    }

    public async Task<Guid> GetCurrentDeploymentInstanceIdAsync(CancellationToken ct = default)
    {
        var (_, trial) = await EnsureDeploymentAsync(ct);
        return trial.InstanceId;
    }

    /// <summary>After a valid license import, attach all tenant rows to the current deployment instance.</summary>
    public async Task RebindAllTenantDataToCurrentDeploymentAsync(CancellationToken ct = default)
    {
        var instanceId = await GetCurrentDeploymentInstanceIdAsync(ct);
        await _db.Users.ExecuteUpdateAsync(
            u => u.SetProperty(x => x.DeploymentInstanceId, instanceId),
            ct);
        await _db.Set<Domain.Entities.Process>().ExecuteUpdateAsync(
            p => p.SetProperty(x => x.DeploymentInstanceId, instanceId),
            ct);
    }

    private async Task BackfillUnboundTenantDataAsync(Guid instanceId, CancellationToken ct)
    {
        await _db.Users.Where(u => u.DeploymentInstanceId == null)
            .ExecuteUpdateAsync(u => u.SetProperty(x => x.DeploymentInstanceId, instanceId), ct);
        await _db.Set<Domain.Entities.Process>().Where(p => p.DeploymentInstanceId == null)
            .ExecuteUpdateAsync(p => p.SetProperty(x => x.DeploymentInstanceId, instanceId), ct);
    }

    private static void EnsureTrialInstanceId(DeploymentTrialRecord trial, ref bool dirty)
    {
        if (trial.InstanceId == Guid.Empty)
        {
            trial.InstanceId = Guid.NewGuid();
            dirty = true;
        }
    }

    private async Task<(DeploymentAnchor Anchor, DeploymentTrialRecord Trial)> EnsureDeploymentAsync(CancellationToken ct)
    {
        var fp = ServerHostFingerprint.ComputeHash();
        var trial = await _db.DeploymentTrialRecords
            .FirstOrDefaultAsync(t => t.ServerFingerprintHash == fp, ct);
        var anchor = await _db.DeploymentAnchors.OrderBy(a => a.Id).FirstOrDefaultAsync(ct);
        var dirty = false;

        if (anchor is not null)
        {
            if (string.IsNullOrEmpty(anchor.ServerFingerprintHash))
            {
                anchor.ServerFingerprintHash = fp;
                dirty = true;
            }

            if (trial is null)
            {
                trial = new DeploymentTrialRecord
                {
                    ServerFingerprintHash = fp,
                    TrialStartedUtc = anchor.CreatedAtUtc,
                    TrialDays = 3,
                    CreatedAtUtc = DateTime.UtcNow,
                    LinkedAnchorId = anchor.AnchorId,
                    InstanceId = Guid.NewGuid()
                };
                _db.DeploymentTrialRecords.Add(trial);
                dirty = true;
            }
            else
            {
                EnsureTrialInstanceId(trial, ref dirty);
            }

            if (trial.LinkedAnchorId != anchor.AnchorId)
            {
                trial.LinkedAnchorId = anchor.AnchorId;
                dirty = true;
            }

            if (dirty)
            {
                await _db.SaveChangesAsync(ct);
                _cache.Remove(CacheKeyValidation);
                _cache.Remove(CacheKeyRuntime);
            }

            await BackfillUnboundTenantDataAsync(trial.InstanceId, ct);
            return (anchor, trial);
        }

        var utcNow = DateTime.UtcNow;
        if (trial is null)
        {
            trial = new DeploymentTrialRecord
            {
                ServerFingerprintHash = fp,
                TrialStartedUtc = utcNow,
                TrialDays = 3,
                CreatedAtUtc = utcNow,
                InstanceId = Guid.NewGuid()
            };
            _db.DeploymentTrialRecords.Add(trial);
        }
        else
        {
            EnsureTrialInstanceId(trial, ref dirty);
            if (dirty)
                await _db.SaveChangesAsync(ct);
        }

        anchor = new DeploymentAnchor
        {
            AnchorId = Guid.NewGuid(),
            CreatedAtUtc = trial.TrialStartedUtc,
            ServerFingerprintHash = fp,
            MonotonicCounter = 0,
            LastTrustedUtc = utcNow
        };
        trial.LinkedAnchorId = anchor.AnchorId;
        _db.DeploymentAnchors.Add(anchor);
        await _db.SaveChangesAsync(ct);
        _cache.Remove(CacheKeyValidation);
        _cache.Remove(CacheKeyRuntime);
        await BackfillUnboundTenantDataAsync(trial.InstanceId, ct);
        return (anchor, trial);
    }

    public async Task<LicenseRuntimeState> GetRuntimeStateAsync(CancellationToken ct = default)
    {
        var cacheKey = BuildRuntimeCacheKey();
        if (_cache.TryGetValue(cacheKey, out LicenseRuntimeState? cached) && cached is not null)
            return cached;

        var state = await BuildRuntimeStateAsync(ct);
        _cache.Set(cacheKey, state, CacheTtl);
        return state;
    }

    private string BuildRuntimeCacheKey()
    {
        var (host, _) = _hostAccessor.GetCurrent();
        if (string.IsNullOrWhiteSpace(host))
            return CacheKeyRuntime;
        return CacheKeyRuntime + ":" + host.Trim().ToLowerInvariant();
    }

    public async Task<LicenseValidationResult> ValidateCurrentAsync(CancellationToken ct = default)
    {
        if (_cache.TryGetValue(CacheKeyValidation, out LicenseValidationResult? cached) && cached is not null)
            return cached;

        var result = await ValidateCurrentCoreAsync(ct);
        _cache.Set(CacheKeyValidation, result, CacheTtl);
        return result;
    }

    public async Task<LicenseDisplayDto> GetDisplayAsync(CancellationToken ct = default)
    {
        var (anchor, trial) = await EnsureDeploymentAsync(ct);
        var runtime = await GetRuntimeStateAsync(ct);
        var validation = await ValidateCurrentAsync(ct);
        var activeUsers = await CountActiveUsersAsync(ct);
        var pendingRestart = await _settings.GetAsync(SystemSettingKeys.PendingConnectionRestart, "", ct);
        var updateUrl = await _settings.GetAsync(SystemSettingKeys.UpdateServerUrl, UpdateCheckService.DefaultUpdateUrl, ct);

        var dto = new LicenseDisplayDto
        {
            LicensingEnabled = true,
            RuntimeMode = runtime.Mode.ToString(),
            Status = validation.Status.ToString(),
            StatusMessage = validation.Message,
            ActiveUserCount = activeUsers,
            DeploymentAnchorShort = ShortId(anchor.AnchorId.ToString("D")),
            ServerFingerprintShort = ServerHostFingerprint.ShortHash(
                string.IsNullOrEmpty(anchor.ServerFingerprintHash)
                    ? ServerHostFingerprint.ComputeHash()
                    : anchor.ServerFingerprintHash),
            TrialDaysRemaining = runtime.TrialDaysRemaining,
            AllowUpdates = runtime.AllowsUpdates,
            AllowLegacyMigration = runtime.AllowsLegacyMigration,
            ShowCopyright = runtime.ShowCopyright,
            UpdateServerUrl = updateUrl,
            PendingConnectionRestart = string.IsNullOrWhiteSpace(pendingRestart) ? null : pendingRestart
        };

        var payload = runtime.Payload ?? validation.Payload;
        if (payload is not null)
        {
            dto.OrganizationName = payload.OrganizationName;
            dto.LicenseIdShort = ShortId(payload.LicenseId);
            dto.IssuedAtUtc = payload.IssuedAtUtc;
            dto.ValidUntilUtc = payload.ValidUntilUtc;
            dto.MaxUsers = payload.MaxUsers;
            dto.Sequence = payload.Sequence;
            dto.DatabaseServerHint = ExtractServerHint(payload.DatabaseConnectionString);
            dto.AllowedHost = payload.AllowedHost;
            if (payload.ValidUntilUtc > DateTime.UtcNow)
                dto.DaysRemaining = (int)Math.Ceiling((payload.ValidUntilUtc - DateTime.UtcNow).TotalDays);
        }

        var stored = await GetStoredLicenseAsync(ct);
        ApplyValidityWindow(dto, trial, runtime, stored, payload);

        dto.AllowedHost ??= stored?.AllowedHost;

        if (runtime.Reason == LicenseRestrictionReason.HostMismatch)
        {
            dto.RuntimeMode = LicenseRuntimeMode.Restricted.ToString();
            dto.Status = "HostMismatch";
            dto.StatusMessage = null;
        }

        return dto;
    }

    private static void ApplyValidityWindow(
        LicenseDisplayDto dto,
        DeploymentTrialRecord trial,
        LicenseRuntimeState runtime,
        StoredLicense? stored,
        LicensePayload? payload)
    {
        var trialDays = stored?.TrialDays ?? trial.TrialDays;
        if (trialDays <= 0)
            trialDays = 3;
        var trialStart = trial.TrialStartedUtc;
        var trialEndUtc = trialStart.Date.AddDays(trialDays);

        switch (runtime.Mode)
        {
            case LicenseRuntimeMode.Trial:
                dto.ValidityStartsAtUtc = trialStart;
                dto.ValidityEndsAtUtc = trialEndUtc;
                dto.DaysRemaining ??= runtime.TrialDaysRemaining;
                break;
            case LicenseRuntimeMode.Licensed when payload is not null:
                dto.ValidityStartsAtUtc = payload.IssuedAtUtc;
                dto.ValidityEndsAtUtc = payload.ValidUntilUtc;
                if (payload.ValidUntilUtc > DateTime.UtcNow && dto.DaysRemaining is null)
                    dto.DaysRemaining = (int)Math.Ceiling((payload.ValidUntilUtc - DateTime.UtcNow).TotalDays);
                break;
            case LicenseRuntimeMode.Restricted:
                if (payload?.ValidUntilUtc is not null)
                {
                    dto.ValidityStartsAtUtc = payload.IssuedAtUtc;
                    dto.ValidityEndsAtUtc = payload.ValidUntilUtc;
                }
                else
                {
                    dto.ValidityStartsAtUtc = trialStart;
                    dto.ValidityEndsAtUtc = trialEndUtc;
                }
                break;
        }
    }

    public async Task<string> ExportActivationRequestJsonAsync(string? organizationHint = null, CancellationToken ct = default)
    {
        var anchor = await EnsureAnchorAsync(ct);
        var fp = ServerHostFingerprint.ComputeHash();
        var request = new ActivationRequest
        {
            DeploymentAnchorId = anchor.AnchorId.ToString("D"),
            OrganizationHint = organizationHint,
            MachineName = Environment.MachineName,
            ServerFingerprintHash = fp,
            AppVersion = typeof(LicenseService).Assembly.GetName().Version?.ToString(),
            RequestedAtUtc = DateTime.UtcNow
        };
        return LicenseJson.SerializeActivationRequest(request);
    }

    public async Task<(bool ok, string? errorKey)> ImportAsync(string rawJson, CancellationToken ct = default)
    {
        var doc = LicenseJson.TryParseDocument(rawJson);
        if (doc is null)
            return (false, "license.error.invalidFile");

        var anchor = await EnsureAnchorAsync(ct);
        var stored = await GetStoredLicenseAsync(ct);
        var previousSequence = stored?.Sequence;

        var validation = LicenseValidator.ValidateDocument(
            doc,
            anchor.AnchorId.ToString("D"),
            _publicKeyPem,
            DateTime.UtcNow,
            previousSequence);

        if (!validation.IsValid || validation.Payload is null)
            return (false, MapErrorKey(validation.Status));

        var payload = validation.Payload;
        if (!string.IsNullOrWhiteSpace(payload.AllowedHost)
            && !LicenseHostBinding.TryNormalize(payload.AllowedHost, out _))
            return (false, "license.error.invalidHost");

        var utcNow = DateTime.UtcNow;
        if (utcNow < anchor.LastTrustedUtc.AddMinutes(-5))
            return (false, "license.error.clockRollback");

        if (stored is not null)
            _db.StoredLicenses.Remove(stored);

        _db.StoredLicenses.Add(new StoredLicense
        {
            RawJson = rawJson.Trim(),
            LicenseId = payload.LicenseId,
            Sequence = payload.Sequence,
            ValidUntilUtc = payload.ValidUntilUtc,
            MaxUsers = payload.MaxUsers,
            OrganizationName = payload.OrganizationName,
            AllowUpdates = payload.AllowUpdates,
            AllowLegacyMigration = payload.AllowLegacyMigration,
            TrialDays = payload.TrialDays > 0 ? payload.TrialDays : 3,
            DatabaseServerHint = ExtractServerHint(payload.DatabaseConnectionString),
            AllowedHost = string.IsNullOrWhiteSpace(payload.AllowedHost)
                ? null
                : LicenseHostBinding.TryNormalize(payload.AllowedHost, out var normalizedHost)
                    ? normalizedHost
                    : payload.AllowedHost.Trim(),
            ImportedAtUtc = utcNow
        });

        anchor.MonotonicCounter = Math.Max(anchor.MonotonicCounter, payload.Sequence);
        anchor.LastTrustedUtc = utcNow > anchor.LastTrustedUtc ? utcNow : anchor.LastTrustedUtc;

        if (!string.IsNullOrWhiteSpace(payload.DatabaseConnectionString))
        {
            await _settings.SetAsync(SystemSettingKeys.LicensedDatabaseConnection, payload.DatabaseConnectionString.Trim(), ct);
            await _settings.SetAsync(SystemSettingKeys.PendingConnectionRestart, "1", ct);
        }

        if (!string.IsNullOrWhiteSpace(payload.UpdateServerUrl))
            await _settings.SetAsync(SystemSettingKeys.UpdateServerUrl, payload.UpdateServerUrl.Trim(), ct);

        if (!string.IsNullOrWhiteSpace(payload.OrganizationName)
            && string.IsNullOrWhiteSpace(await _settings.GetAsync(SystemSettingKeys.BrandOrganization, "", ct)))
        {
            await _settings.SetAsync(SystemSettingKeys.BrandOrganization, payload.OrganizationName.Trim(), ct);
        }

        await _db.SaveChangesAsync(ct);
        await RebindAllTenantDataToCurrentDeploymentAsync(ct);
        _cache.Remove(CacheKeyValidation);
        _cache.Remove(CacheKeyRuntime);
        return (true, null);
    }

    public async Task EnsureCanAddActiveUserAsync(CancellationToken ct = default)
    {
        var runtime = await GetRuntimeStateAsync(ct);
        if (runtime.Mode == LicenseRuntimeMode.Restricted)
            throw new InvalidOperationException("license.error.invalid");

        if (runtime.Mode != LicenseRuntimeMode.Licensed)
            return;

        if (runtime.Payload?.MaxUsers is not int max)
            return;

        var active = await CountActiveUsersAsync(ct);
        if (active >= max)
            throw new InvalidOperationException($"license.error.seatLimit:{max}");
    }

    public async Task EnsureCanActivateUserAsync(int additionalActiveCount = 1, CancellationToken ct = default)
    {
        var runtime = await GetRuntimeStateAsync(ct);
        if (runtime.Mode == LicenseRuntimeMode.Restricted)
            throw new InvalidOperationException("license.error.invalid");

        if (runtime.Mode != LicenseRuntimeMode.Licensed)
            return;

        if (runtime.Payload?.MaxUsers is not int max)
            return;

        var active = await CountActiveUsersAsync(ct);
        if (active + additionalActiveCount > max)
            throw new InvalidOperationException($"license.error.seatLimit:{max}");
    }

    public async Task<int> CountActiveUsersAsync(CancellationToken ct = default)
        => await _db.Users.CountAsync(u => u.IsActive, ct);

    private async Task<LicenseRuntimeState> BuildRuntimeStateAsync(CancellationToken ct)
    {
        var (_, trial) = await EnsureDeploymentAsync(ct);
        var stored = await GetStoredLicenseAsync(ct);
        var validation = await ValidateCurrentCoreAsync(ct);

        if (validation.Status == LicenseValidationStatus.Valid && validation.Payload is { } licensedPayload)
        {
            if (!string.IsNullOrWhiteSpace(licensedPayload.AllowedHost))
            {
                var (host, ip) = _hostAccessor.GetCurrent();
                if (host is not null || ip is not null)
                {
                    if (!LicenseHostBinding.IsRequestAllowed(licensedPayload.AllowedHost, host, ip))
                        return LicenseRuntimeState.Restricted(LicenseRestrictionReason.HostMismatch, licensedPayload);
                }
            }

            return LicenseRuntimeState.Licensed(licensedPayload);
        }

        var trialDays = stored?.TrialDays ?? trial.TrialDays;
        if (trialDays <= 0)
            trialDays = 3;

        if (stored is null)
        {
            var remaining = trialDays - (int)Math.Floor((DateTime.UtcNow - trial.TrialStartedUtc).TotalDays);
            if (remaining > 0)
                return LicenseRuntimeState.Trial(remaining);
            return LicenseRuntimeState.Restricted(LicenseRestrictionReason.TrialExpired);
        }

        var payload = validation.Payload ?? LicenseJson.TryParseDocument(stored.RawJson)?.Payload;
        return validation.Status switch
        {
            LicenseValidationStatus.Expired => LicenseRuntimeState.Restricted(LicenseRestrictionReason.LicenseExpired, payload),
            LicenseValidationStatus.Missing => LicenseRuntimeState.Restricted(LicenseRestrictionReason.LicenseMissing, payload),
            _ => LicenseRuntimeState.Restricted(LicenseRestrictionReason.LicenseInvalid, payload)
        };
    }

    private async Task<LicenseValidationResult> ValidateCurrentCoreAsync(CancellationToken ct)
    {
        var anchor = await EnsureAnchorAsync(ct);
        var stored = await GetStoredLicenseAsync(ct);
        if (stored is null)
            return LicenseValidationResult.Fail(LicenseValidationStatus.Missing, "No license imported yet.");

        var doc = LicenseJson.TryParseDocument(stored.RawJson);
        if (doc is null)
            return LicenseValidationResult.Fail(LicenseValidationStatus.InvalidSignature, "Stored license is corrupted.");

        return LicenseValidator.ValidateDocument(
            doc,
            anchor.AnchorId.ToString("D"),
            _publicKeyPem,
            DateTime.UtcNow,
            null);
    }

    private async Task<StoredLicense?> GetStoredLicenseAsync(CancellationToken ct)
        => await _db.StoredLicenses.OrderByDescending(l => l.ImportedAtUtc).FirstOrDefaultAsync(ct);

    private static string ShortId(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "-";
        return value.Length <= 8 ? value : value[..8].ToUpperInvariant();
    }

    private static string? ExtractServerHint(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
            return null;
        try
        {
            var builder = new SqlConnectionStringBuilder(connectionString);
            return string.IsNullOrWhiteSpace(builder.DataSource) ? null : builder.DataSource;
        }
        catch
        {
            return null;
        }
    }

    private static string MapErrorKey(LicenseValidationStatus status) => status switch
    {
        LicenseValidationStatus.Missing => "license.error.missing",
        LicenseValidationStatus.InvalidSignature => "license.error.invalidSignature",
        LicenseValidationStatus.WrongAnchor => "license.error.wrongAnchor",
        LicenseValidationStatus.Expired => "license.error.expired",
        LicenseValidationStatus.SequenceRollback => "license.error.sequenceRollback",
        _ => "license.error.invalid"
    };
}
