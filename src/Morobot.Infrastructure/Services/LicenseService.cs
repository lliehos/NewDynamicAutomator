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
    private readonly string _publicKeyPem;

    public LicenseService(
        AppDbContext db,
        IOptions<MorobotOptions> options,
        SystemSettingsService settings,
        IMemoryCache cache)
    {
        _db = db;
        _options = options.Value;
        _settings = settings;
        _cache = cache;
        _publicKeyPem = string.IsNullOrWhiteSpace(_options.LicensePublicKeyPem)
            ? LicensePublicKeys.Active
            : _options.LicensePublicKeyPem;
    }

    public bool IsLicensingEnabled => _options.IsEnterprise;

    public async Task<DeploymentAnchor> EnsureAnchorAsync(CancellationToken ct = default)
    {
        var anchor = await _db.DeploymentAnchors.OrderBy(a => a.Id).FirstOrDefaultAsync(ct);
        if (anchor is not null)
            return anchor;

        anchor = new DeploymentAnchor
        {
            AnchorId = Guid.NewGuid(),
            CreatedAtUtc = DateTime.UtcNow,
            MonotonicCounter = 0,
            LastTrustedUtc = DateTime.UtcNow
        };
        _db.DeploymentAnchors.Add(anchor);
        await _db.SaveChangesAsync(ct);
        _cache.Remove(CacheKeyValidation);
        _cache.Remove(CacheKeyRuntime);
        return anchor;
    }

    public async Task<LicenseRuntimeState> GetRuntimeStateAsync(CancellationToken ct = default)
    {
        if (!IsLicensingEnabled)
            return LicenseRuntimeState.Cloud();

        if (_cache.TryGetValue(CacheKeyRuntime, out LicenseRuntimeState? cached) && cached is not null)
            return cached;

        var state = await BuildRuntimeStateAsync(ct);
        _cache.Set(CacheKeyRuntime, state, CacheTtl);
        return state;
    }

    public async Task<LicenseValidationResult> ValidateCurrentAsync(CancellationToken ct = default)
    {
        if (!IsLicensingEnabled)
            return LicenseValidationResult.NotRequired();

        if (_cache.TryGetValue(CacheKeyValidation, out LicenseValidationResult? cached) && cached is not null)
            return cached;

        var result = await ValidateCurrentCoreAsync(ct);
        _cache.Set(CacheKeyValidation, result, CacheTtl);
        return result;
    }

    public async Task<LicenseDisplayDto> GetDisplayAsync(CancellationToken ct = default)
    {
        if (!IsLicensingEnabled)
        {
            return new LicenseDisplayDto
            {
                LicensingEnabled = false,
                Status = nameof(LicenseValidationStatus.NotRequired),
                RuntimeMode = nameof(LicenseRuntimeMode.NotApplicable),
                ActiveUserCount = await CountActiveUsersAsync(ct)
            };
        }

        var anchor = await EnsureAnchorAsync(ct);
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
            TrialDaysRemaining = runtime.TrialDaysRemaining,
            AllowUpdates = runtime.AllowsUpdates,
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
            if (payload.ValidUntilUtc > DateTime.UtcNow)
                dto.DaysRemaining = (int)Math.Ceiling((payload.ValidUntilUtc - DateTime.UtcNow).TotalDays);
        }

        return dto;
    }

    public async Task<string> ExportActivationRequestJsonAsync(string? organizationHint = null, CancellationToken ct = default)
    {
        var anchor = await EnsureAnchorAsync(ct);
        var request = new ActivationRequest
        {
            DeploymentAnchorId = anchor.AnchorId.ToString("D"),
            OrganizationHint = organizationHint,
            MachineName = Environment.MachineName,
            AppVersion = typeof(LicenseService).Assembly.GetName().Version?.ToString(),
            RequestedAtUtc = DateTime.UtcNow
        };
        return LicenseJson.SerializeActivationRequest(request);
    }

    public async Task<(bool ok, string? errorKey)> ImportAsync(string rawJson, CancellationToken ct = default)
    {
        if (!IsLicensingEnabled)
            return (false, "license.error.notEnterprise");

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
            TrialDays = payload.TrialDays > 0 ? payload.TrialDays : 3,
            DatabaseServerHint = ExtractServerHint(payload.DatabaseConnectionString),
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
        _cache.Remove(CacheKeyValidation);
        _cache.Remove(CacheKeyRuntime);
        return (true, null);
    }

    public async Task EnsureCanAddActiveUserAsync(CancellationToken ct = default)
    {
        if (!IsLicensingEnabled)
            return;

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
        if (!IsLicensingEnabled)
            return;

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
        var anchor = await EnsureAnchorAsync(ct);
        var stored = await GetStoredLicenseAsync(ct);
        var validation = await ValidateCurrentCoreAsync(ct);

        if (validation.Status == LicenseValidationStatus.Valid && validation.Payload is not null)
            return LicenseRuntimeState.Licensed(validation.Payload);

        var trialDays = stored?.TrialDays ?? 3;
        if (stored is null)
        {
            var remaining = trialDays - (int)Math.Floor((DateTime.UtcNow - anchor.CreatedAtUtc).TotalDays);
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
