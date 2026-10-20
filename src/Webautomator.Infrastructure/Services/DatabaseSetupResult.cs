namespace Webautomator.Infrastructure.Services;

/// <summary>
/// The outcome of the startup database check, expressed as something a page can render.
/// </summary>
/// <remarks>
/// The bootstrap has always been able to tell these cases apart internally, but it reported them by
/// throwing — and an exception thrown before the server listens produces a console trace, not a
/// screen an operator can act on. Returning a value instead lets the web layer keep the app alive,
/// explain precisely what is missing, and hand over the exact SQL that fixes it.
///
/// <para>
/// Nothing here is a secret. Under Windows authentication the "credential" is the identity of the
/// process, which the operating system supplies and this application never sees, stores or asks
/// for — so a page showing the diagnosis and the remedy can safely be rendered without a token,
/// and nothing is written to disk.
/// </para>
/// </remarks>
public sealed record DatabaseSetupResult
{
    /// <summary>Everything is in place; the application may continue its normal startup.</summary>
    public bool IsReady { get; init; }

    /// <summary>Which prerequisite failed, or <see cref="DatabaseSetupStage.Ready"/>.</summary>
    public DatabaseSetupStage Stage { get; init; }

    /// <summary>The database the application is configured to use.</summary>
    public string DatabaseName { get; init; } = "";

    /// <summary>The server and instance the application is configured to use, as written.</summary>
    public string DataSource { get; init; } = "";

    /// <summary>
    /// The identity the process authenticates as — what SQL Server will see. Under IIS this is the
    /// Application Pool (<c>IIS APPPOOL\Automator</c>), not the person signed in to Windows, which
    /// is the single most misunderstood fact in this area.
    /// </summary>
    public string Identity { get; init; } = "";

    /// <summary>True when the connection uses Windows authentication rather than a SQL login.</summary>
    public bool UsesWindowsAuthentication { get; init; }

    /// <summary>The SQL Server error number, when the failure came from the server.</summary>
    public int? SqlErrorNumber { get; init; }

    /// <summary>SQL Server's own message, verbatim, for the operator to compare against.</summary>
    public string? ServerMessage { get; init; }

    /// <summary>
    /// A short human-readable summary of what is wrong. Written for an operator, not a developer.
    /// </summary>
    public string Summary { get; init; } = "";

    /// <summary>
    /// The SQL that resolves this specific failure, ready to paste into SSMS on the server.
    /// Built from the configured database and the detected identity, so it is correct for this
    /// deployment rather than a generic example. Empty when <see cref="IsReady"/> is true.
    /// </summary>
    public string RemedySql { get; init; } = "";

    /// <summary>A plain-language note about what the remedy does, and what it does not grant.</summary>
    public string RemedyNote { get; init; } = "";

    public static DatabaseSetupResult Ready(string databaseName, string dataSource, string identity) => new()
    {
        IsReady = true,
        Stage = DatabaseSetupStage.Ready,
        DatabaseName = databaseName,
        DataSource = dataSource,
        Identity = identity
    };
}

/// <summary>The prerequisite that stopped startup, in the order the bootstrap checks them.</summary>
public enum DatabaseSetupStage
{
    /// <summary>Connected successfully; nothing to do.</summary>
    Ready = 0,

    /// <summary>The login itself was refused. Nothing else can be attempted until this is fixed.</summary>
    LoginMissing = 1,

    /// <summary>The login works but the database does not exist, and it could not be created.</summary>
    DatabaseMissing = 2,

    /// <summary>The database exists but this login has no user mapped inside it.</summary>
    UserNotMappedInDatabase = 3,

    /// <summary>The server itself could not be reached — wrong name, stopped service, firewall.</summary>
    ServerUnreachable = 4
}
