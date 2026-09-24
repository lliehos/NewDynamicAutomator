using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ProcessAndDataSourceLastEditor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LastEditorUserId",
                table: "Processes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LastEditorUserId",
                table: "DataSources",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Processes_LastEditorUserId",
                table: "Processes",
                column: "LastEditorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_DataSources_LastEditorUserId",
                table: "DataSources",
                column: "LastEditorUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Processes_Users_LastEditorUserId",
                table: "Processes",
                column: "LastEditorUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_DataSources_Users_LastEditorUserId",
                table: "DataSources",
                column: "LastEditorUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Processes_Users_LastEditorUserId",
                table: "Processes");

            migrationBuilder.DropForeignKey(
                name: "FK_DataSources_Users_LastEditorUserId",
                table: "DataSources");

            migrationBuilder.DropIndex(
                name: "IX_Processes_LastEditorUserId",
                table: "Processes");

            migrationBuilder.DropIndex(
                name: "IX_DataSources_LastEditorUserId",
                table: "DataSources");

            migrationBuilder.DropColumn(
                name: "LastEditorUserId",
                table: "Processes");

            migrationBuilder.DropColumn(
                name: "LastEditorUserId",
                table: "DataSources");
        }
    }
}
