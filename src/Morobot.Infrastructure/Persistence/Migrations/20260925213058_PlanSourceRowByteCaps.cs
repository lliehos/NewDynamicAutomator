using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PlanSourceRowByteCaps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "MaxSourceBytes",
                table: "Plans",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MaxSourceRows",
                table: "Plans",
                type: "int",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MaxSourceBytes",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "MaxSourceRows",
                table: "Plans");
        }
    }
}
