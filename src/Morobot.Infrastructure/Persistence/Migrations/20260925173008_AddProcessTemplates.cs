using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddProcessTemplates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "TemplateId",
                table: "Processes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TemplateVersion",
                table: "Processes",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ProcessTemplates",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Title = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    GraphJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Description = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    Version = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatorUserId = table.Column<int>(type: "int", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProcessTemplates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProcessTemplates_Users_CreatorUserId",
                        column: x => x.CreatorUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Processes_TemplateId",
                table: "Processes",
                column: "TemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_ProcessTemplates_CreatorUserId",
                table: "ProcessTemplates",
                column: "CreatorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ProcessTemplates_Title",
                table: "ProcessTemplates",
                column: "Title");

            migrationBuilder.AddForeignKey(
                name: "FK_Processes_ProcessTemplates_TemplateId",
                table: "Processes",
                column: "TemplateId",
                principalTable: "ProcessTemplates",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Processes_ProcessTemplates_TemplateId",
                table: "Processes");

            migrationBuilder.DropTable(
                name: "ProcessTemplates");

            migrationBuilder.DropIndex(
                name: "IX_Processes_TemplateId",
                table: "Processes");

            migrationBuilder.DropColumn(
                name: "TemplateId",
                table: "Processes");

            migrationBuilder.DropColumn(
                name: "TemplateVersion",
                table: "Processes");
        }
    }
}
