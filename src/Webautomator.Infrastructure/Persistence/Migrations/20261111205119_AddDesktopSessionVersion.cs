using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Webautomator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDesktopSessionVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DesktopSessionVersion",
                table: "Users",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DesktopSessionVersion",
                table: "Users");
        }
    }
}
