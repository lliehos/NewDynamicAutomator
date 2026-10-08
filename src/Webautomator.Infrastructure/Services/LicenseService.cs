using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Webautomator.Contracts.Licensing;
using Webautomator.Domain;
using Webautomator.Domain.Entities;
using Webautomator.Infrastructure.Options;
using Webautomator.Infrastructure.Persistence;
using Webautomator.Licensing;

namespace Webautomator.Infrastructure.Services;

public sealed class LicenseService
{
    private const string CacheKeyValidation = "license:validation";
    private const string CacheKeyRuntime = "license:runtime";
    /// <summary>
    /// Stamp of the cache keys minted under the current licence generation. The runtime state is
    /// cached PER REQUEST HOST (<see cref="BuildRuntimeCacheKey"/>), so the set of keys in play
    /// depends on which hosts have been requested. A generation counter lets a single import evict
    /// every one of them at once instead of guessing; bumping it simply orphans the old keys, which
    /// then expire on their own TTL.
    /// </summary>
    private const string CacheKeyGeneration = "license:generation";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(1);

    private readonly AppDbContext _db;
    private readonly WebautomatorOptions _options;
    private readonly SystemSettingsService _settings;
    private readonly IMemoryCache _cache;
    private readonly ILicenseRequestHostAccessor _hostAccessor;
    private readonly string _publicKeyPem;

    public LicenseService(
        AppDbContext db,
        IOptions<WebautomatorOptions> options,
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
                InvalidateLicenseCache();
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
        InvalidateLicenseCache();
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

    /// <summary>
    /// Drops every licence-backed cache entry. Called whenever the stored licence, the deployment
    /// anchor or the trial record changes.
    /// </summary>
    /// <remarks>
    /// Unscoped keys are removed by name, but the runtime state is keyed by request host
    /// (<see cref="BuildRuntimeCacheKey"/>), so there is no single key to remove. Do NOT "fix" a
    /// stale runtime state by removing only <see cref="CacheKeyRuntime"/>: that misses every
    /// host-scoped entry, which is exactly the bug where importing a licence left the admin page
    /// showing the previous — even restricted — licence for the rest of the minute, and, because
    /// the licence page is the one screen whose whole job is to reflect an import, it looked like
    /// the import had silently failed. Bumping the generation (<see cref="CacheKeyGeneration"/>,)
    /// folds into <see cref="BuildRuntimeCacheKey"/> so all of them become unreachable at once.
    /// </remarks>
    private void InvalidateLicenseCache()
    {
        _cache.Remove(CacheKeyValidation);
        _cache.Remove(CacheKeyRuntime);
        // Old generation is intentionally left to expire; only the counter has to move.
        _cache.Set(CacheKeyGeneration, CurrentGeneration() + 1);
    }

    private long CurrentGeneration()
        => _cache.TryGetValue(CacheKeyGeneration, out long generation) ? generation : 0;

    /// <summary>
    /// Whether the signed licence sold this deployment the front-end package — i.e. whether the
    /// public site is even permitted here.
    /// </summary>
    /// <remarks>
    /// A narrow reader over <see cref="GetRuntimeStateAsync"/> rather than a second source of truth.
    /// It exists so call sites read as the question they are actually asking ("did we buy the front
    /// end?") instead of reaching into the runtime state and re-deriving the rule, which is how the
    /// same flag ends up interpreted two different ways. Note this is only the LICENCE half: whether
    /// the site is actually shown is a separate admin switch, and both must agree.
    /// </remarks>
    public async Task<bool> IsFrontPackageEnabledAsync(CancellationToken ct = default)
        => (await GetRuntimeStateAsync(ct)).AllowsFrontPackage;

    private string BuildRuntimeCacheKey()
    {
        var generation = ":g" + CurrentGeneration();
        var (host, _) = _hostAccessor.GetCurrent();
        if (string.IsNullOrWhiteSpace(host))
            return CacheKeyRuntime + generation;
        return CacheKeyRuntime + generation + ":" + host.Trim().ToLowerInvariant();
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
            AllowPlanManagement = runtime.AllowsPlanManagement,
            AllowBilingual = runtime.AllowsBilingual,
            AllowFrontPackage = runtime.AllowsFrontPackage,
            AllowLocalRun = runtime.AllowsLocalRun,
            AllowCommerce = runtime.AllowsCommerce,
            AllowSoftwarePurchase = runtime.AllowsSoftwarePurchase,
            AllowSelfIssuedLicenses = runtime.AllowsSelfIssuedLicenses,
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
            dto.ReferralWidgetUrl = LicenseReferralUrl.TryNormalize(payload.ReferralWidgetUrl);
            if (payload.ValidUntilUtc > DateTime.UtcNow)
                dto.DaysRemaining = (int)Math.Ceiling((payload.ValidUntilUtc - DateTime.UtcNow).TotalDays);
        }

        var stored = await GetStoredLicenseAsync(ct);
        ApplyValidityWindow(dto, trial, runtime, stored, payload);

        dto.AllowedHost ??= stored?.AllowedHost;
        dto.ReferralWidgetUrl ??= stored?.ReferralWidgetUrl;
        dto.ServerBaseUrl ??= stored?.ServerBaseUrl;

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

    /// <summary>
    /// Build the signed license document an order bought.
    /// </summary>
    /// <remarks>
    /// Signed with a SEPARATE issuing key, never the vendor's signing key: this deployment verifies
    /// licenses with a public key and has no business holding the private half of it. The storefront
    /// operator (the vendor, or a reseller the vendor authorised) supplies an issuing key through
    /// configuration; without it the method refuses rather than producing an unsigned or
    /// wrongly-signed document, because a license that fails to verify is worse than none.
    ///
    /// Generated from the order's own stored terms, so the document reflects what was actually paid
    /// for even if the price list or feature set changed since.
    /// </remarks>
    public async Task<string?> BuildOrderLicenseJsonAsync(Webautomator.Domain.Entities.Order order, CancellationToken ct = default)
    {
        var runtime = await GetRuntimeStateAsync(ct);
        if (!runtime.AllowsSelfIssuedLicenses) return null;

        var issuingKey = _options.OrderIssuingKeyPem;
        if (string.IsNullOrWhiteSpace(issuingKey)) return null;

        var anchor = await EnsureAnchorAsync(ct);
        var terms = Webautomator.Infrastructure.Services.Payments.CheckoutService.ReadTerms(order);

        var users = terms?["users"]?.GetValue<int?>() ?? 1;
        var term = terms?["term"]?.GetValue<string>() ?? "monthly";
        var validUntil = term switch
        {
            "yearly" => DateTime.UtcNow.AddYears(1),
            "perpetual" => DateTime.UtcNow.AddYears(50),
            _ => DateTime.UtcNow.AddMonths(1)
        };

        // The purchased feature set becomes the license flags — this is the whole point of the
        // purchase wizard: what the buyer ticked is what the issued license allows.
        var payload = new LicensePayload
        {
            LicenseId = $"order-{order.Id}-{Guid.NewGuid():N}"[..40],
            OrganizationName = terms?["organization"]?.GetValue<string>(),
            DeploymentAnchorId = anchor.AnchorId.ToString("D"),
            IssuedAtUtc = DateTime.UtcNow,
            ValidUntilUtc = validUntil,
            // Sequence must be strictly greater than the stored one or the import refuses it as a
            // rollback; the order id is monotonic, so basing it there is both unique and increasing.
            Sequence = Math.Max(DateTime.UtcNow.Ticks, order.Id),
            MaxUsers = users,
            AllowPlanManagement = true,
            AllowBilingual = ReadBool(terms, "bilingual", true),
            AllowLocalRun = ReadBool(terms, "local_run", false),
            AllowFrontPackage = ReadBool(terms, "front_package", false),
            AllowCommerce = ReadBool(terms, "commerce", false),
            AllowSoftwarePurchase = ReadBool(terms, "commerce", false),
            AllowSelfIssuedLicenses = ReadBool(terms, "commerce", false),
            // A license sold through the storefront is a full one for the deployment it was bought
            // for; the issuing key is what makes it trustworthy.
            AllowUpdates = true
        };

        var doc = LicenseCrypto.Sign(payload, issuingKey);
        return LicenseJson.SerializeDocument(doc);
    }

    /// <summary>Whether this deployment can issue its own licenses (flag on AND an issuing key set).</summary>
    public bool CanIssueLicenses =>
        !string.IsNullOrWhiteSpace(_options.OrderIssuingKeyPem);

    private static bool ReadBool(JsonObject? terms, string key, bool fallback)
        => terms?[key]?.GetValue<bool?>() ?? fallback;

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

        if (!LicenseReferralUrl.IsAcceptable(payload.ReferralWidgetUrl))
            return (false, "license.error.invalidReferralUrl");

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
            AllowPlanManagement = payload.AllowPlanManagement,
            AllowBilingual = payload.AllowBilingual,
            AllowCommerce = payload.AllowCommerce,
            AllowSoftwarePurchase = payload.AllowSoftwarePurchase,
            AllowSelfIssuedLicenses = payload.AllowSelfIssuedLicenses,
            ServerBaseUrl = string.IsNullOrWhiteSpace(payload.ServerBaseUrl)
                ? null
                : payload.ServerBaseUrl.TrimEnd('/'),
            TrialDays = payload.TrialDays > 0 ? payload.TrialDays : 3,
            DatabaseServerHint = ExtractServerHint(payload.DatabaseConnectionString),
            AllowedHost = string.IsNullOrWhiteSpace(payload.AllowedHost)
                ? null
                : LicenseHostBinding.TryNormalize(payload.AllowedHost, out var normalizedHost)
                    ? normalizedHost
                    : payload.AllowedHost.Trim(),
            ReferralWidgetUrl = LicenseReferralUrl.TryNormalize(payload.ReferralWidgetUrl),
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
        InvalidateLicenseCache();
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
