using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDataSourceCellProvenance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LastEditorUserId",
                table: "DataSourceCells",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAtUtc",
                table: "DataSourceCells",
                type: "datetime2",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DataSourceCells_LastEditorUserId",
                table: "DataSourceCells",
                column: "LastEditorUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_DataSourceCells_Users_LastEditorUserId",
                table: "DataSourceCells",
                column: "LastEditorUserId",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DataSourceCells_Users_LastEditorUserId",
                table: "DataSourceCells");

            migrationBuilder.DropIndex(
                name: "IX_DataSourceCells_LastEditorUserId",
                table: "DataSourceCells");

            migrationBuilder.DropColumn(
                name: "LastEditorUserId",
                table: "DataSourceCells");

            migrationBuilder.DropColumn(
                name: "UpdatedAtUtc",
                table: "DataSourceCells");
        }
    }
}
