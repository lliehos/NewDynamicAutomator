using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AdminSettingsAndPlanPasswordPolicy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CodeStr",
                table: "Plans",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.Sql(@"
UPDATE [Plans] SET [CodeStr] = CASE [Code]
  WHEN 1 THEN N'Local'
  WHEN 2 THEN N'Free'
  WHEN 3 THEN N'Pro'
  WHEN 4 THEN N'Gold'
  ELSE CONCAT(N'Plan', [Code])
END;");

            migrationBuilder.DropIndex(
                name: "IX_Plans_Code",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "Code",
                table: "Plans");

            migrationBuilder.RenameColumn(
                name: "CodeStr",
                table: "Plans",
                newName: "Code");

            migrationBuilder.AlterColumn<string>(
                name: "Code",
                table: "Plans",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(40)",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Plans_Code",
                table: "Plans",
                column: "Code",
                unique: true);

            migrationBuilder.AddColumn<bool>(
                name: "AllowSelfUpgrade",
                table: "Plans",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "MinPasswordLength",
                table: "Plans",
                type: "int",
                nullable: false,
                defaultValue: 3);

            migrationBuilder.AddColumn<bool>(
                name: "RequireLetterAndDigit",
                table: "Plans",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql(@"
UPDATE [Plans] SET
  [MinPasswordLength] = CASE [Code]
    WHEN N'Pro' THEN 8
    WHEN N'Gold' THEN 8
    ELSE 3 END,
  [RequireLetterAndDigit] = CASE WHEN [Code] IN (N'Pro', N'Gold') THEN 1 ELSE 0 END,
  [AllowSelfUpgrade] = CASE WHEN [Code] IN (N'Pro', N'Gold') THEN 1 ELSE 0 END;");

            migrationBuilder.CreateTable(
                name: "SystemSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Key = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Value = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    Group = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    LabelFa = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    LabelEn = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    HintFa = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    HintEn = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SystemSettings", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SystemSettings_Key",
                table: "SystemSettings",
                column: "Key",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SystemSettings");

            migrationBuilder.DropColumn(
                name: "AllowSelfUpgrade",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "MinPasswordLength",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "RequireLetterAndDigit",
                table: "Plans");

            migrationBuilder.AddColumn<int>(
                name: "CodeInt",
                table: "Plans",
                type: "int",
                nullable: true);

            migrationBuilder.Sql(@"
UPDATE [Plans] SET [CodeInt] = CASE [Code]
  WHEN N'Local' THEN 1
  WHEN N'Free' THEN 2
  WHEN N'Pro' THEN 3
  WHEN N'Gold' THEN 4
  ELSE 99 END;");

            migrationBuilder.DropIndex(
                name: "IX_Plans_Code",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "Code",
                table: "Plans");

            migrationBuilder.RenameColumn(
                name: "CodeInt",
                table: "Plans",
                newName: "Code");

            migrationBuilder.AlterColumn<int>(
                name: "Code",
                table: "Plans",
                type: "int",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Plans_Code",
                table: "Plans",
                column: "Code",
                unique: true);
        }
    }
}
