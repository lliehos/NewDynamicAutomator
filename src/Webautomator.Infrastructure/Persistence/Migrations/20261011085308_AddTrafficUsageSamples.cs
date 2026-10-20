using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Webautomator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTrafficUsageSamples : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TrafficUsageSamples",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CapturedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Scope = table.Column<int>(type: "int", nullable: false),
                    Key = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    BytesIn = table.Column<long>(type: "bigint", nullable: false),
                    BytesOut = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrafficUsageSamples", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TrafficUsageSamples_CapturedAtUtc",
                table: "TrafficUsageSamples",
                column: "CapturedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_TrafficUsageSamples_Scope_Key_CapturedAtUtc",
                table: "TrafficUsageSamples",
                columns: new[] { "Scope", "Key", "CapturedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TrafficUsageSamples");
        }
    }
}
