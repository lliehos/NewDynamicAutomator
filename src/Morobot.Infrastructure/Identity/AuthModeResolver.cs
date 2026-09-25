using Morobot.Contracts.Auth;
using Morobot.Domain;
using Morobot.Infrastructure.Services;

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

    public AuthModeResolver(SystemSettingsService settings)
    {
        _settings = settings;
    }

    /// <summary>Which providers may sign a user in.</summary>
    public sealed record AuthProviders(bool Local, bool Ldap)
    {
        /// <summary>True when only the directory may sign users in.</summary>
        public bool LdapOnly => Ldap && !Local;

        /// <summary>
        /// The legacy single value, kept so existing callers and logs keep working. When both
        /// providers are enabled this reports Local, because a local match is tried first and is
        /// the provider that cannot be unavailable.
        /// </summary>
        public AuthMode Mode => Local ? AuthMode.Local : AuthMode.Ldap;
    }

    /// <summary>Read the two switch values, normalised so at least one is on.</summary>
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
        return new AuthProviders(normalized.local, normalized.ldap);
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

    public async Task<LdapOptions> GetLdapOptionsAsync(CancellationToken ct = default)
    {
        var useTlsRaw = await _settings.GetAsync(SystemSettingKeys.LdapUseTls, "false", ct);
        var portRaw = await _settings.GetAsync(SystemSettingKeys.LdapPort, "", ct);

        return new LdapOptions
        {
            Host = (await _settings.GetAsync(SystemSettingKeys.LdapHost, "", ct)).Trim(),
            Port = int.TryParse(portRaw, out var port) && port is > 0 and <= 65535 ? port : 0,
            BaseDn = (await _settings.GetAsync(SystemSettingKeys.LdapBaseDn, "", ct)).Trim(),
            BindDn = (await _settings.GetAsync(SystemSettingKeys.LdapBindDn, "", ct)).Trim(),
            BindPassword = await _settings.GetAsync(SystemSettingKeys.LdapBindPassword, "", ct),
            UserTemplate = await _settings.GetAsync(SystemSettingKeys.LdapUserTemplate, "{0}", ct),
            UseTls = IsTrue(useTlsRaw)
        };
    }

    private static bool IsTrue(string? raw)
        => string.Equals(raw?.Trim(), "true", StringComparison.OrdinalIgnoreCase) || raw?.Trim() == "1";
}
