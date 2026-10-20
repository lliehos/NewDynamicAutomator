﻿using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Webautomator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTemplateSourceProcess : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SourceProcessId",
                table: "ProcessTemplates",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProcessTemplates_SourceProcessId",
                table: "ProcessTemplates",
                column: "SourceProcessId",
                unique: true,
                filter: "[SourceProcessId] IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_ProcessTemplates_Processes_SourceProcessId",
                table: "ProcessTemplates",
                column: "SourceProcessId",
                principalTable: "Processes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ProcessTemplates_Processes_SourceProcessId",
                table: "ProcessTemplates");

            migrationBuilder.DropIndex(
                name: "IX_ProcessTemplates_SourceProcessId",
                table: "ProcessTemplates");

            migrationBuilder.DropColumn(
                name: "SourceProcessId",
                table: "ProcessTemplates");
        }
    }
}
