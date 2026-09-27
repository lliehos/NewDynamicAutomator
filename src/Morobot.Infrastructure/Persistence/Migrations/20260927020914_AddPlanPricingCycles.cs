using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPlanPricingCycles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<bool>(
                name: "AllowPlanManagement",
                table: "StoredLicenses",
                type: "bit",
                nullable: false,
                defaultValue: true,
                oldClrType: typeof(bool),
                oldType: "bit");

            migrationBuilder.AddColumn<decimal>(
                name: "MonthlyDiscountPercent",
                table: "Plans",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "MonthlyPrice",
                table: "Plans",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PriceCurrency",
                table: "Plans",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: false,
                // Existing plans get the currency the product is sold in, not an empty string: a
                // blank currency renders a price with no unit, which reads as a bug to the admin.
                defaultValue: "IRR");

            migrationBuilder.AddColumn<decimal>(
                name: "YearlyDiscountPercent",
                table: "Plans",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "YearlyPrice",
                table: "Plans",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MonthlyDiscountPercent",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "MonthlyPrice",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "PriceCurrency",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "YearlyDiscountPercent",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "YearlyPrice",
                table: "Plans");

            migrationBuilder.AlterColumn<bool>(
                name: "AllowPlanManagement",
                table: "StoredLicenses",
                type: "bit",
                nullable: false,
                oldClrType: typeof(bool),
                oldType: "bit",
                oldDefaultValue: true);
        }
    }
}
