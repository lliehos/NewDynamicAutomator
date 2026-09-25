using Morobot.Contracts.Auth;
using Morobot.Domain;
using Morobot.Infrastructure.Services;

namespace Morobot.Infrastructure.Identity;

/// <summary>
/// Reads the sign-in configuration out of the settings table.
/// </summary>
/// <remarks>
/// The mode is parsed leniently and falls back to <see cref="AuthMode.Local"/>. A settings row
/// that was hand-edited, or a half-finished switch to a directory, must never be able to lock
/// everyone out of an installation — including the administrator who would fix it.
/// </remarks>
public sealed class AuthModeResolver
{
    private readonly SystemSettingsService _settings;

    public AuthModeResolver(SystemSettingsService settings)
    {
        _settings = settings;
    }

    public async Task<AuthMode> GetModeAsync(CancellationToken ct = default)
    {
        var raw = await _settings.GetAsync(SystemSettingKeys.AuthMode, nameof(AuthMode.Local), ct);
        return ParseMode(raw);
    }

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
