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
/// How the typed user name is presented to the directory.
/// </summary>
/// <remarks>
/// Active Directory will not accept a bare user name over a simple (Basic) bind — it needs the
/// account to be qualified with its domain. This enum is that choice, in the two forms AD actually
/// accepts, so an administrator picks one instead of hand-writing a format string.
/// </remarks>
public enum LdapNameFormat
{
    /// <summary>
    /// <c>DOMAIN\user</c> (the classic NetBIOS form). The usual choice for on-premises AD. The
    /// domain is used when it is set, otherwise the part of the host name before the first dot.
    /// </summary>
    DomainBackslash = 0,

    /// <summary>
    /// <c>user@domain</c> (userPrincipalName). The usual choice for Microsoft 365 / Azure AD and
    /// for directories that are reached over the internet.
    /// </summary>
    UserPrincipalName = 1,

    /// <summary>
    /// The name exactly as typed, with nothing added. For directories that resolve a bare account
    /// name on their own (and for testing against one), where prefixing a domain would break the
    /// lookup rather than help it.
    /// </summary>
    PlainUserName = 2
}

/// <summary>
/// Directory settings, resolved from the settings table rather than appsettings so an
/// administrator can change them without editing a file on the server.
/// </summary>
/// <remarks>
/// Deliberately small: a sign-in bind needs to know WHERE the directory is (host, port), HOW to
/// present the name (the format below) and WHETHER the connection is secured (TLS). Anything else
/// — a search base, a service account, a DN template — belongs to a directory *search*, and this
/// authenticator does not search: it binds. Carrying those fields anyway meant an administrator
/// filled in four boxes that no code ever read, and a half-filled configuration looked like a
/// working one.
/// </remarks>
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

    /// <summary>
    /// The AD domain to qualify the account with, e.g. <c>corp</c> or <c>corp.local</c>. Only used
    /// by <see cref="LdapNameFormat.DomainBackslash"/>, and optional: when blank the part of
    /// <see cref="Host"/> before the first dot is used, so a normal on-premises install that
    /// points at the domain controller needs nothing here.
    /// </summary>
    public string Domain { get; set; } = string.Empty;

    /// <summary>Which of the two forms AD accepts is used for the sign-in name.</summary>
    public LdapNameFormat NameFormat { get; set; } = LdapNameFormat.DomainBackslash;

    /// <summary>
    /// Require TLS (LDAPS). Uses the TLS port when no explicit port was set. Worth keeping on: a
    /// simple bind sends the password, and without TLS it crosses the network in the clear.
    /// </summary>
    public bool UseTls { get; set; }

    /// <summary>Effective port: the configured one, or the transport's conventional default.</summary>
    public int EffectivePort => Port > 0 ? Port : (UseTls ? DefaultTlsPort : DefaultPort);

    /// <summary>
    /// Whether enough is configured to attempt a bind. A half-filled configuration must not be
    /// treated as "LDAP is on": that would lock every user out of a working install.
    /// </summary>
    public bool IsUsable =>
        !string.IsNullOrWhiteSpace(Host) && Uri.CheckHostName(Host.Trim()) != UriHostNameType.Unknown;

    /// <summary>
    /// The domain to qualify with: the configured one, or the host name up to its first dot.
    /// </summary>
    public string EffectiveDomain
    {
        get
        {
            var configured = Domain?.Trim().Trim('\\', '@');
            if (!string.IsNullOrEmpty(configured)) return configured;
            var host = Host?.Trim() ?? "";
            var dot = host.IndexOf('.');
            return dot > 0 ? host[..dot] : host;
        }
    }

    /// <summary>
    /// Turn the typed user name into the sign-in name the directory expects.
    /// </summary>
    /// <remarks>
    /// A name that is already qualified is passed through untouched for the two domain forms, so
    /// someone may type <c>CORP\ali</c> or <c>ali@corp.local</c> and get exactly what they typed
    /// rather than a doubled prefix. <see cref="LdapNameFormat.PlainUserName"/> never qualifies at
    /// all — that is the point of it.
    /// </remarks>
    public string BuildSignInName(string userName)
    {
        var name = (userName ?? "").Trim();
        if (string.IsNullOrEmpty(name)) return name;

        if (NameFormat == LdapNameFormat.PlainUserName) return name;
        if (name.Contains('\\') || name.Contains('@')) return name;

        return NameFormat == LdapNameFormat.UserPrincipalName
            ? $"{name}@{EffectiveDomain}"
            : $"{EffectiveDomain}\\{name}";
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
