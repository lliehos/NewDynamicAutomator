using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class GuestMachineAndCanvasConcurrency : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAtUtc",
                table: "Tasks",
                type: "datetime2",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.Sql("UPDATE [Tasks] SET [UpdatedAtUtc] = [CreatedAtUtc] WHERE [UpdatedAtUtc] < '2000-01-01'");

            migrationBuilder.AddColumn<string>(
                name: "MachineFingerprint",
                table: "DeviceSessions",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DeviceSessions_MachineFingerprint",
                table: "DeviceSessions",
                column: "MachineFingerprint");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_DeviceSessions_MachineFingerprint",
                table: "DeviceSessions");

            migrationBuilder.DropColumn(
                name: "UpdatedAtUtc",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "MachineFingerprint",
                table: "DeviceSessions");
        }
    }
}
