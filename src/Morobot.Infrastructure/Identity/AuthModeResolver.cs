using Morobot.Contracts.Auth;
using Morobot.Domain;
using Morobot.Infrastructure.Persistence;
using Morobot.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Identity;

/// <summary>
/// Reads the sign-in configuration out of the settings table.
/// </summary>
/// <remarks>
/// Two switches replaced the old single-choice <c>AuthMode</c>: one for the built-in user table and
/// one for the directory. Making them independent is what lets an install accept both at once —
/// the previous enum could only ever name one, so switching LDAP on silently stopped local
/// sign-in, including for the administrator who had just enabled it.
///
/// Parsing is lenient and always resolves to a usable configuration. A hand-edited settings row, or
/// a half-finished switch to a directory, must never be able to lock everyone out.
/// </remarks>
public sealed class AuthModeResolver
{
    private readonly SystemSettingsService _settings;
    private readonly AppDbContext _db;

    public AuthModeResolver(SystemSettingsService settings, AppDbContext db)
    {
        _settings = settings;
        _db = db;
    }

    /// <summary>Which providers may sign a user in.</summary>
    public sealed record AuthProviders(bool Local, bool Ldap)
    {
        /// <summary>True when only the directory may sign users in.</summary>
        public bool LdapOnly => Ldap && !Local;

        /// <summary>True when only the built-in user table may sign users in.</summary>
        public bool LocalOnly => Local && !Ldap;

        /// <summary>True when either provider may sign a user in.</summary>
        public bool Both => Local && Ldap;

        /// <summary>
        /// The legacy single value, kept so existing callers and logs keep working. With both
        /// providers live it reports Local, because that is the one that cannot be unavailable —
        /// callers that must tell them apart should use <see cref="ResolveFor"/> instead.
        /// </summary>
        public AuthMode Mode => Local ? AuthMode.Local : AuthMode.Ldap;

        /// <summary>
        /// Which single provider <paramref name="userName"/> should be checked against.
        /// </summary>
        /// <remarks>
        /// This is what makes running both providers at once actually work. The old API exposed a
        /// single mode and callers branched on <c>mode == Ldap</c>, so switching the directory on
        /// while leaving local sign-in enabled silently sent every request down the local path —
        /// the directory was configured but never consulted.
        ///
        /// With both enabled the name decides: a purely numeric name is a national code, which the
        /// built-in table stores, so it can never be a directory account and is checked locally. A
        /// name that is actually in the directory is checked there. Anything else — a name nobody
        /// has claimed yet — falls back to the local table.
        /// </remarks>
        public AuthMode ResolveFor(string? userName)
        {
            if (LocalOnly) return AuthMode.Local;
            if (LdapOnly) return AuthMode.Ldap;
            // Both are live. A national code can only be a local account, and a name the directory
            // is known to own is checked there; everything else falls back to the local table, which
            // is the provider that cannot be unavailable.
            if (IsNumeric(userName)) return AuthMode.Local;
            var name = userName?.Trim();
            return !string.IsNullOrEmpty(name) && DirectoryNames.Contains(name) ? AuthMode.Ldap : AuthMode.Local;
        }

        /// <summary>
        /// Names confirmed to come from the directory, filled in when both providers are live.
        /// A directory-provisioned row carries no password hash, which is a reliable marker that
        /// its credentials come from the directory rather than from here.
        /// </summary>
        internal IReadOnlySet<string> DirectoryNames { get; init; } =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// A name made only of digits, i.e. a national code. Directory account names are not
        /// numeric, so such a name is always a local account.
        /// </summary>
        private static bool IsNumeric(string? userName)
        {
            var name = userName?.Trim();
            if (string.IsNullOrEmpty(name)) return false;
            foreach (var c in name)
                if (c is < '0' or > '9') return false;
            return true;
        }
    }

    /// <summary>
    /// Read the two switch values, normalised so at least one is on.
    /// </summary>
    /// <remarks>
    /// Membership of <see cref="AuthProviders.DirectoryNames"/> is filled from the user table:
    /// a row created by directory auto-provisioning carries no password hash, which is a reliable
    /// marker that its credentials come from the directory rather than from here. That is what
    /// lets a single sign-in form route a name to the right provider without asking the visitor.
    /// </remarks>
    public async Task<AuthProviders> GetProvidersAsync(CancellationToken ct = default)
    {
        var localRaw = await _settings.GetAsync(SystemSettingKeys.AuthLocalEnabled, "true", ct);
        var ldapRaw = await _settings.GetAsync(SystemSettingKeys.AuthLdapEnabled, "false", ct);

        // Back-compat: an install whose only row is the old AuthMode must keep its behaviour.
        var hasNewKeys = await _settings.ExistsAsync(SystemSettingKeys.AuthLocalEnabled, ct)
                         || await _settings.ExistsAsync(SystemSettingKeys.AuthLdapEnabled, ct);
        if (!hasNewKeys)
        {
            var legacy = ParseMode(await _settings.GetAsync(SystemSettingKeys.AuthMode, nameof(AuthMode.Local), ct));
            return legacy == AuthMode.Ldap
                ? new AuthProviders(Local: false, Ldap: true)
                : new AuthProviders(Local: true, Ldap: false);
        }

        var normalized = SystemSettingKeys.NormalizeAuthProviders(IsTrue(localRaw), IsTrue(ldapRaw));
        var providers = new AuthProviders(normalized.local, normalized.ldap);

        // Only worth the query when both are live: with a single provider there is nothing to
        // route between, and the extra lookup would run on every sign-in for no benefit.
        if (!providers.Both) return providers;

        var directoryNames = await _db.Users
            .AsNoTracking()
            .Where(u => u.PasswordHash == null || u.PasswordHash == "")
            .Select(u => u.UserName)
            .ToListAsync(ct);

        return providers with { DirectoryNames = new HashSet<string>(directoryNames, StringComparer.OrdinalIgnoreCase) };
    }

    /// <summary>The provider that decides sign-in, for callers that only need one answer.</summary>
    public async Task<AuthMode> GetModeAsync(CancellationToken ct = default)
        => (await GetProvidersAsync(ct)).Mode;

    /// <summary>
    /// Mode parsing, kept pure so the fallback behaviour is testable without a database.
    /// Anything that is not an explicit "Ldap" means Local.
    /// </summary>
    public static AuthMode ParseMode(string? raw)
        => Enum.TryParse<AuthMode>(raw?.Trim(), ignoreCase: true, out var mode) && mode == AuthMode.Ldap
            ? AuthMode.Ldap
            : AuthMode.Local;

    /// <summary>
    /// Read the directory settings. Deliberately tiny — host, port, how to qualify the name, and
    /// whether the connection is secured — because the authenticator binds rather than searches.
    /// </summary>
    public async Task<LdapOptions> GetLdapOptionsAsync(CancellationToken ct = default)
    {
        var useTlsRaw = await _settings.GetAsync(SystemSettingKeys.LdapUseTls, "false", ct);
        var portRaw = await _settings.GetAsync(SystemSettingKeys.LdapPort, "", ct);
        var formatRaw = await _settings.GetAsync(SystemSettingKeys.LdapNameFormat, nameof(LdapNameFormat.DomainBackslash), ct);

        return new LdapOptions
        {
            Host = (await _settings.GetAsync(SystemSettingKeys.LdapHost, "", ct)).Trim(),
            Port = int.TryParse(portRaw, out var port) && port is > 0 and <= 65535 ? port : 0,
            Domain = (await _settings.GetAsync(SystemSettingKeys.LdapDomain, "", ct)).Trim(),
            // An unrecognised value falls back to the on-premises AD default rather than throwing:
            // a hand-edited row must not be able to break sign-in entirely.
            NameFormat = Enum.TryParse<LdapNameFormat>(formatRaw?.Trim(), ignoreCase: true, out var fmt)
                ? fmt
                : LdapNameFormat.DomainBackslash,
            UseTls = IsTrue(useTlsRaw)
        };
    }

    private static bool IsTrue(string? raw)
        => string.Equals(raw?.Trim(), "true", StringComparison.OrdinalIgnoreCase) || raw?.Trim() == "1";
}
