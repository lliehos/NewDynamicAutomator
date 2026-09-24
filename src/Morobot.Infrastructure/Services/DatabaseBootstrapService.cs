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

    public static async Task MigrateAndSeedAsync(AppDbContext db, ILogger? log = null, CancellationToken ct = default)
    {
        await db.Database.MigrateAsync(ct);
        await DbSeeder.SeedAsync(db);
        log?.LogInformation("Database schema migrated and seed completed.");
    }
}
