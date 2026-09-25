using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DropUnusedProcessExecuteColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastExecuteUserId",
                table: "Processes");

            migrationBuilder.DropColumn(
                name: "LastExecutedAtUtc",
                table: "Processes");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LastExecuteUserId",
                table: "Processes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastExecutedAtUtc",
                table: "Processes",
                type: "datetime2",
                nullable: true);
        }
    }
}
