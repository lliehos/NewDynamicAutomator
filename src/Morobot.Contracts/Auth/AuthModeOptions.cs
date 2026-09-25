namespace Morobot.Contracts.Auth;

/// <summary>
/// Where sign-in is checked. The built-in user table is the default so an installation that
/// never touches this keeps the behaviour it had before directory support existed.
/// </summary>
public enum AuthMode
{
    /// <summary>User name and password are checked against the local user table.</summary>
    Local = 0,

    /// <summary>
    /// The directory decides the password; the local table still supplies the role and plan, so a
    /// directory user must exist locally (or be created by auto-provisioning) to have any
    /// permissions.
    /// </summary>
    Ldap = 1
}

/// <summary>
/// Directory settings, resolved from the settings table rather than appsettings so an
/// administrator can change them without editing a file on the server.
/// </summary>
public sealed class LdapOptions
{
    public const int DefaultPort = 389;
    public const int DefaultTlsPort = 636;

    /// <summary>Host name or IP. No scheme, no port — those have their own fields.</summary>
    public string Host { get; set; } = string.Empty;

    /// <summary>
    /// TCP port. 0 means "pick the conventional one for the transport" so an admin who only
    /// types a host is not required to know the port.
    /// </summary>
    public int Port { get; set; }

    /// <summary>Base DN for searches, e.g. <c>DC=corp,DC=local</c>.</summary>
    public string BaseDn { get; set; } = string.Empty;

    /// <summary>Account used to search when the directory refuses anonymous binds.</summary>
    public string BindDn { get; set; } = string.Empty;

    public string BindPassword { get; set; } = string.Empty;

    /// <summary>
    /// Turns the typed user name into a sign-in name, e.g. <c>{0}@corp.local</c> or
    /// <c>CN={0},OU=People,DC=corp,DC=local</c>. Without a template the name is used as typed.
    /// </summary>
    public string UserTemplate { get; set; } = "{0}";

    /// <summary>Require TLS. Uses LDAPS on the TLS port when no explicit port was set.</summary>
    public bool UseTls { get; set; }

    /// <summary>Effective port: the configured one, or the transport's conventional default.</summary>
    public int EffectivePort => Port > 0 ? Port : (UseTls ? DefaultTlsPort : DefaultPort);

    /// <summary>
    /// Whether enough is configured to attempt a bind. A half-filled configuration must not be
    /// treated as "LDAP is on": that would lock every user out of a working install.
    /// </summary>
    public bool IsUsable =>
        !string.IsNullOrWhiteSpace(Host) && Uri.CheckHostName(Host.Trim()) != UriHostNameType.Unknown;

    /// <summary>Apply the user-name template, falling back to the name as typed.</summary>
    public string ApplyUserTemplate(string userName)
    {
        if (string.IsNullOrWhiteSpace(UserTemplate) || !UserTemplate.Contains("{0}"))
            return userName;
        return string.Format(UserTemplate, userName);
    }
}

/// <summary>Outcome of a directory sign-in attempt, kept separate from the password check.</summary>
public enum LdapAuthResult
{
    /// <summary>The directory accepted the credentials.</summary>
    Success,

    /// <summary>The directory rejected them.</summary>
    InvalidCredentials,

    /// <summary>
    /// The directory could not be reached or answered unusably. Distinct from a rejection so the
    /// log can tell "wrong password" from "the server is down" — and so a misconfiguration is not
    /// reported to the user as if they typed the wrong password.
    /// </summary>
    Unavailable
}

/// <summary>Checks a user name and password against a directory.</summary>
public interface ILdapAuthenticator
{
    Task<LdapAuthResult> AuthenticateAsync(
        LdapOptions options,
        string userName,
        string password,
        CancellationToken ct = default);
}
