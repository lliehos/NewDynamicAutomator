using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddStoredLicenseAllowPlanManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Default TRUE, not the EF-generated false. This column mirrors a flag that has to stay
            // allowed for licences signed before it existed, so backfilling existing rows with
            // "false" would record the opposite of the rule the app enforces.
            migrationBuilder.AddColumn<bool>(
                name: "AllowPlanManagement",
                table: "StoredLicenses",
                type: "bit",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AllowPlanManagement",
                table: "StoredLicenses");
        }
    }
}
