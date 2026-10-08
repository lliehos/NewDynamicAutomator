using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Webautomator.Infrastructure.Persistence;

#nullable disable

namespace Webautomator.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Track per-source whether a local run's changes have not been synced yet.
    /// </summary>
    /// <remarks>
    /// Two columns on <c>DataSources</c>: the flag the panel shows as the sync icon, and the moment
    /// it was set (diagnostics only). Defaulted to false so every existing source reads as "in sync",
    /// which is the only safe assumption — there is no way to know retroactively whether a local run
    /// ever touched a source on any client. The model snapshot already carries both properties, so
    /// this migration is the schema half only.
    /// </remarks>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261009140000_DataSourceNeedsSync")]
    public partial class DataSourceNeedsSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "NeedsSync",
                table: "DataSources",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "NeedsSyncAtUtc",
                table: "DataSources",
                type: "datetime2",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "NeedsSync", table: "DataSources");
            migrationBuilder.DropColumn(name: "NeedsSyncAtUtc", table: "DataSources");
        }
    }
}
