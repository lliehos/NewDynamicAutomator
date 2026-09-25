using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LicenseReferralWidgetUrl : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ReferralWidgetUrl",
                table: "StoredLicenses",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReferralWidgetUrl",
                table: "StoredLicenses");
        }
    }
}
