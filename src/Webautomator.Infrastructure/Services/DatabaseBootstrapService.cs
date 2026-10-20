using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Webautomator.Infrastructure.Persistence;

namespace Webautomator.Infrastructure.Services;

/// <summary>
/// Gets the configured database into a state the application can migrate, and explains precisely
/// what is missing when it cannot — without ever asking for, or storing, a credential.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why there is no credential prompt.</b> The deployment this was designed for authenticates to
/// SQL Server as the Application Pool (<c>IIS APPPOOL\&lt;pool&gt;</c>), which is a Windows identity.
/// The operating system hands that identity to the driver; the application never sees it, so there
/// is nothing to ask for and nothing to save. What is missing is <i>a DBA creating a login for an
/// existing Windows principal</i> — a one-time administrator action on the database server, not a
/// secret this application could hold.
/// </para>
/// <para>
/// <b>Why it returns instead of throwing.</b> A throw here happens before the web server listens, so
/// the operator gets a console trace and no application at all. Returning a
/// <see cref="DatabaseSetupResult"/> lets the host stay up, serve one explanatory page, and retry on
/// demand once the DBA has run the supplied SQL. The normal path is unchanged: on a working
/// deployment this reports ready and startup continues.
/// </para>
/// </remarks>
public static class DatabaseBootstrapService
{
    /// <summary>Server-side error numbers that mean "the login was not accepted".</summary>
    private static bool IsLoginFailure(SqlException ex) => ex.Number is 18456 or 18452;

    /// <summary>Server-side error number for "the login is fine, but it cannot open this database".</summary>
    private const int CannotOpenDatabaseError = 4060;

    /// <summary>
    /// The identity the connection authenticates as, as SQL Server will see it.
    /// </summary>
    /// <remarks>
    /// For Windows authentication this is the identity of the running <b>process</b>. Under IIS that
    /// is the Application Pool — <c>IIS APPPOOL\&lt;pool&gt;</c> — and under a Windows Service it is
    /// usually the machine account, <c>DOMAIN\HOST$</c>. An operator who assumes it is their own
    /// desktop login has no way to see otherwise from the driver error alone, which is why this is
    /// surfaced everywhere a failure is reported.
    /// </remarks>
    public static string DescribeIdentity(SqlConnectionStringBuilder builder) =>
        builder.IntegratedSecurity || string.IsNullOrWhiteSpace(builder.UserID)
            ? $@"{Environment.UserDomainName}\{Environment.UserName}"
            : builder.UserID;

    /// <summary>
    /// Ensures the configured database exists and is reachable, returning a diagnosis rather than
    /// throwing when it is not.
    /// </summary>
    public static async Task<DatabaseSetupResult> EnsureDatabaseAsync(
        string connectionString, ILogger? log = null, CancellationToken ct = default)
    {
        SqlConnectionStringBuilder builder;
        try
        {
            builder = new SqlConnectionStringBuilder(connectionString);
        }
        catch (Exception ex)
        {
            return new DatabaseSetupResult
            {
                Stage = DatabaseSetupStage.ServerUnreachable,
                Summary = "The configured connection string is not a valid SQL Server connection " +
                          "string. Check ConnectionStrings:Default in appsettings.json.",
                ServerMessage = ex.Message
            };
        }

        var databaseName = builder.InitialCatalog;
        var identity = DescribeIdentity(builder);
        var windowsAuth = builder.IntegratedSecurity || string.IsNullOrWhiteSpace(builder.UserID);

        if (string.IsNullOrWhiteSpace(databaseName))
        {
            return Failure(builder, identity, windowsAuth, DatabaseSetupStage.ServerUnreachable,
                "The connection string does not name a database. Add 'Database=WebautomatorDb' to " +
                "ConnectionStrings:Default.");
        }

        // Step 1 — can the process reach the server at all? Connecting to master is the cheapest
        // probe, and its answer separates "wrong server / no login" from every database-level issue.
        var (masterReachable, masterFailure) = await TryOpenAsync(builder, "master", ct);

        // Step 2 — create the database when the login is allowed to and it is genuinely absent.
        // A login without dbcreator fails here, which is expected and not fatal: the database may
        // already exist, and step 3 is the authoritative test.
        if (masterReachable)
        {
            try
            {
                await CreateDatabaseIfMissingAsync(builder, databaseName, log, ct);
            }
            catch (SqlException ex) when (ex.Number is 262 or 15247)
            {
                // 262 = CREATE DATABASE permission denied; 15247 = no permission to run the check.
                // Both mean "the database may exist, but this login cannot create one" — carry on
                // and let the direct connection decide.
                log?.LogInformation(
                    "Login '{Identity}' may not create databases ({Error}); assuming '{Database}' " +
                    "is provisioned already.", identity, ex.Number, databaseName);
            }
        }

        // Step 3 — the authoritative check: open the configured database. If this succeeds the
        // application is good to go, regardless of what happened above.
        var (dbReachable, dbFailure) = await TryOpenAsync(builder, databaseName, ct);
        if (dbReachable)
        {
            log?.LogInformation(
                "Database '{Database}' on '{Server}' is ready (identity: {Identity}).",
                databaseName, builder.DataSource, identity);
            return DatabaseSetupResult.Ready(databaseName, builder.DataSource, identity);
        }

        // Something is wrong. Choose the stage by what SQL Server actually said, so the page can
        // name the one missing thing instead of listing every possibility.
        var failure = dbFailure ?? masterFailure;

        if (failure is not null && IsLoginFailure(failure))
        {
            // The login itself does not exist. Nothing else can be attempted until a DBA creates it.
            return Failure(builder, identity, windowsAuth, DatabaseSetupStage.LoginMissing,
                $"SQL Server does not accept the login '{identity}'.", failure);
        }

        if (failure is { Number: CannotOpenDatabaseError })
        {
            // The login was accepted, so the identity is known — only the database is out of reach.
            // Distinguish "the database is not there" from "it is there but this login is not a user
            // in it", because the remedy differs and SQL Server uses this one number for both.
            var databaseExists = masterReachable
                && await DatabaseExistsAsync(builder, databaseName, ct);

            if (!databaseExists)
            {
                return Failure(builder, identity, windowsAuth, DatabaseSetupStage.DatabaseMissing,
                    $"The database '{databaseName}' does not exist on '{builder.DataSource}'.",
                    failure);
            }

            return Failure(builder, identity, windowsAuth, DatabaseSetupStage.UserNotMappedInDatabase,
                $"The database '{databaseName}' exists, but the login '{identity}' has no user " +
                "mapped inside it.", failure);
        }

        if (failure is not null)
        {
            return Failure(builder, identity, windowsAuth, DatabaseSetupStage.ServerUnreachable,
                $"SQL Server could not be reached at '{builder.DataSource}'.", failure);
        }

        return Failure(builder, identity, windowsAuth, DatabaseSetupStage.ServerUnreachable,
            $"Could not open the database '{databaseName}' on '{builder.DataSource}'.");
    }

    /// <summary>Opens a connection to a named catalog, reporting success as a value.</summary>
    private static async Task<(bool Ok, SqlException? Failure)> TryOpenAsync(
        SqlConnectionStringBuilder builder, string catalog, CancellationToken ct)
    {
        var target = new SqlConnectionStringBuilder(builder.ConnectionString) { InitialCatalog = catalog };
        await using var conn = new SqlConnection(target.ConnectionString);
        try
        {
            await conn.OpenAsync(ct);
            return (true, null);
        }
        catch (SqlException ex)
        {
            return (false, ex);
        }
    }

    /// <summary>
    /// Creates the database only when it is genuinely absent. Needs <c>dbcreator</c> or
    /// <c>sysadmin</c>; callers treat a permission failure as "not my job" and continue.
    /// </summary>
    private static async Task CreateDatabaseIfMissingAsync(
        SqlConnectionStringBuilder builder, string databaseName, ILogger? log, CancellationToken ct)
    {
        var master = new SqlConnectionStringBuilder(builder.ConnectionString) { InitialCatalog = "master" };
        await using var conn = new SqlConnection(master.ConnectionString);
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = @name)
            BEGIN
              DECLARE @sql nvarchar(max) = N'CREATE DATABASE [' + REPLACE(@name, N']', N']]') + N']';
              EXEC(@sql);
            END
            """;
        cmd.Parameters.AddWithValue("@name", databaseName);
        await cmd.ExecuteNonQueryAsync(ct);
        log?.LogInformation("Database '{Database}' created.", databaseName);
    }

    /// <summary>True when the named database exists, asked from <c>master</c>.</summary>
    private static async Task<bool> DatabaseExistsAsync(
        SqlConnectionStringBuilder builder, string databaseName, CancellationToken ct)
    {
        var master = new SqlConnectionStringBuilder(builder.ConnectionString) { InitialCatalog = "master" };
        await using var conn = new SqlConnection(master.ConnectionString);
        try
        {
            await conn.OpenAsync(ct);
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT CASE WHEN DB_ID(@name) IS NULL THEN 0 ELSE 1 END";
            cmd.Parameters.AddWithValue("@name", databaseName);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct)) == 1;
        }
        catch
        {
            // Cannot tell — report "exists" so the page asks for the narrower remedy (map the user)
            // rather than telling the operator to create a database that may already be there.
            return true;
        }
    }

    private static DatabaseSetupResult Failure(
        SqlConnectionStringBuilder builder, string identity, bool windowsAuth,
        DatabaseSetupStage stage, string summary, SqlException? ex = null) => new()
    {
        IsReady = false,
        Stage = stage,
        DatabaseName = builder.InitialCatalog ?? "",
        DataSource = builder.DataSource ?? "",
        Identity = identity,
        UsesWindowsAuthentication = windowsAuth,
        SqlErrorNumber = ex?.Number,
        ServerMessage = ex?.Message.Trim(),
        Summary = summary,
        RemedySql = BuildRemedySql(stage, builder, identity),
        RemedyNote = BuildRemedyNote(stage)
    };

    /// <summary>
    /// The exact SQL that fixes this failure, written for this deployment rather than as a generic
    /// example. Safe to paste into SSMS as one batch: each statement is guarded, so re-running it
    /// after a partial fix does not fail.
    /// </summary>
    private static string BuildRemedySql(DatabaseSetupStage stage, SqlConnectionStringBuilder builder, string identity)
    {
        var db = builder.InitialCatalog ?? "WebautomatorDb";
        var isWindowsLogin = builder.IntegratedSecurity || string.IsNullOrWhiteSpace(builder.UserID);

        // A Windows login already exists as a principal and is only registered with the server; a
        // SQL login has to be created with a password the DBA chooses, so it cannot be pre-written.
        var createLogin = isWindowsLogin
            ? $"IF SUSER_ID(N'{identity}') IS NULL CREATE LOGIN [{identity}] FROM WINDOWS;"
            : $"-- CREATE LOGIN [{identity}] WITH PASSWORD = N'<choose a strong password>';";

        return stage switch
        {
            DatabaseSetupStage.LoginMissing =>
                $"""
                 -- 1) Register the application's identity as a login (server level).
                 {createLogin}

                 -- 2) The application creates its own database on first run, so it needs dbcreator.
                 --    Drop this line if the DBA prefers to create the database manually.
                 IF IS_SRVROLEMEMBER(N'dbcreator', N'{identity}') = 0
                     ALTER SERVER ROLE [dbcreator] ADD MEMBER [{identity}];
                 """,

            DatabaseSetupStage.DatabaseMissing =>
                $"""
                 -- The login is fine; only the database is missing. Either create it here, or grant
                 -- dbcreator and let the application create it on the next start.
                 IF DB_ID(N'{db}') IS NULL
                     CREATE DATABASE [{db}];
                 """,

            DatabaseSetupStage.UserNotMappedInDatabase =>
                $"""
                 -- The database exists and the login is registered; it just needs a user inside it.
                 USE [{db}];
                 IF USER_ID(N'{identity}') IS NULL
                     CREATE USER [{identity}] FOR LOGIN [{identity}];
                 ALTER ROLE [db_owner] ADD MEMBER [{identity}];
                 """,

            _ =>
                $"""
                 -- Show what the server sees for this identity.
                 SELECT SUSER_ID(N'{identity}') AS LoginId,
                        IS_SRVROLEMEMBER(N'dbcreator', N'{identity}') AS IsDbCreator;
                 """
        };
    }

    private static string BuildRemedyNote(DatabaseSetupStage stage) => stage switch
    {
        DatabaseSetupStage.LoginMissing =>
            "This grants the application login the right to create its own database, and nothing " +
            "outside it. If your policy forbids dbcreator, drop that line and create the database " +
            "manually instead.",

        DatabaseSetupStage.DatabaseMissing =>
            "Creating the database is the whole remedy. The application creates its own tables on " +
            "the next start.",

        DatabaseSetupStage.UserNotMappedInDatabase =>
            "db_owner is scoped to this one database. It grants no server-level permission.",

        _ =>
            "Run this on the SQL Server to inspect the current state before making changes."
    };

    /// <summary>
    /// Apply any pending migrations and seed defaults. Runs on **every** startup,
    /// not just first run, so a new build's schema changes land when the updated
    /// app comes back up (the offline updater restarts it as its last step).
    /// Pending migrations are logged before they are applied, and a failure is
    /// surfaced with an actionable message rather than a bare EF exception —
    /// a boot loop after an update is otherwise hard to diagnose.
    /// </summary>
    public static async Task MigrateAndSeedAsync(AppDbContext db, ILogger? log = null, CancellationToken ct = default)
    {
        IReadOnlyList<string> pending;
        try
        {
            pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
        }
        catch (Exception ex)
        {
            log?.LogError(ex, "Could not read the migration history — database may be unreachable.");
            throw;
        }

        if (pending.Count > 0)
        {
            log?.LogInformation(
                "Applying {Count} pending migration(s): {Migrations}",
                pending.Count,
                string.Join(", ", pending));
        }

        try
        {
            await db.Database.MigrateAsync(ct);
        }
        catch (Exception ex)
        {
            // Wrapped so the log names the failing migrations; the original is kept
            // as the inner exception so the SQL detail is not lost.
            var failing = pending.Count > 0 ? string.Join(", ", pending) : "(unknown)";
            log?.LogError(ex, "Database migration failed. Pending: {Migrations}", failing);
            throw new InvalidOperationException(
                $"Database migration failed while applying: {failing}. " +
                "The application cannot start until the schema is up to date — " +
                "check the SQL Server log/connection and retry, or restore the previous build.",
                ex);
        }

        await DbSeeder.SeedAsync(db);
        log?.LogInformation("Database schema migrated and seed completed.");
    }
}
