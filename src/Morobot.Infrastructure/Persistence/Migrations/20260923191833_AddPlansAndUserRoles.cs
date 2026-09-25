using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPlansAndUserRoles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "PlanExpiresAtUtc",
                table: "Users",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PlanId",
                table: "Users",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Role",
                table: "Users",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "Plans",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Code = table.Column<int>(type: "int", nullable: false),
                    NameFa = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    NameEn = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    MaxTasks = table.Column<int>(type: "int", nullable: true),
                    MaxDataSources = table.Column<int>(type: "int", nullable: true),
                    CanPlay = table.Column<bool>(type: "bit", nullable: false),
                    CanSelector = table.Column<bool>(type: "bit", nullable: false),
                    CanRecord = table.Column<bool>(type: "bit", nullable: false),
                    CanSmart = table.Column<bool>(type: "bit", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Plans", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PlanPrices",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PlanId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Interval = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlanPrices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlanPrices_Plans_PlanId",
                        column: x => x.PlanId,
                        principalTable: "Plans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Users_PlanId",
                table: "Users",
                column: "PlanId");

            migrationBuilder.CreateIndex(
                name: "IX_PlanPrices_PlanId",
                table: "PlanPrices",
                column: "PlanId");

            migrationBuilder.CreateIndex(
                name: "IX_Plans_Code",
                table: "Plans",
                column: "Code",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Users_Plans_PlanId",
                table: "Users",
                column: "PlanId",
                principalTable: "Plans",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Users_Plans_PlanId",
                table: "Users");

            migrationBuilder.DropTable(
                name: "PlanPrices");

            migrationBuilder.DropTable(
                name: "Plans");

            migrationBuilder.DropIndex(
                name: "IX_Users_PlanId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "PlanExpiresAtUtc",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "PlanId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Role",
                table: "Users");
        }
    }
}
