using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Morobot.Infrastructure.Persistence;

namespace Morobot.Infrastructure.Services;

public static class DatabaseBootstrapService
{
    public static async Task EnsureSqlServerDatabaseAsync(string connectionString, ILogger? log = null, CancellationToken ct = default)
    {
        var builder = new SqlConnectionStringBuilder(connectionString);
        var databaseName = builder.InitialCatalog;
        if (string.IsNullOrWhiteSpace(databaseName))
            throw new InvalidOperationException("Connection string must include Initial Catalog (database name).");

        var master = new SqlConnectionStringBuilder(connectionString)
        {
            InitialCatalog = "master"
        };

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
        log?.LogInformation("Database '{Database}' is ready.", databaseName);
    }

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
