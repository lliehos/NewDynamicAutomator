using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ExtendEnterpriseLicensing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AllowUpdates",
                table: "StoredLicenses",
                type: "bit",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "DatabaseServerHint",
                table: "StoredLicenses",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TrialDays",
                table: "StoredLicenses",
                type: "int",
                nullable: false,
                defaultValue: 3);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AllowUpdates",
                table: "StoredLicenses");

            migrationBuilder.DropColumn(
                name: "DatabaseServerHint",
                table: "StoredLicenses");

            migrationBuilder.DropColumn(
                name: "TrialDays",
                table: "StoredLicenses");
        }
    }
}
