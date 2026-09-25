using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SystemSettingChangeTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastChangedAtUtc",
                table: "SystemSettings",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LastChangedByUserId",
                table: "SystemSettings",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastChangedByUserName",
                table: "SystemSettings",
                type: "nvarchar(80)",
                maxLength: 80,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastChangedAtUtc",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "LastChangedByUserId",
                table: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "LastChangedByUserName",
                table: "SystemSettings");
        }
    }
}
