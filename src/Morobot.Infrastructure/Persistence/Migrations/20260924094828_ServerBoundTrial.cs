using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ServerBoundTrial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ServerFingerprintHash",
                table: "DeploymentAnchors",
                type: "nvarchar(128)",
                maxLength: 128,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "DeploymentTrialRecords",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ServerFingerprintHash = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    TrialStartedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    TrialDays = table.Column<int>(type: "int", nullable: false, defaultValue: 3),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    LinkedAnchorId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeploymentTrialRecords", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeploymentTrialRecords_ServerFingerprintHash",
                table: "DeploymentTrialRecords",
                column: "ServerFingerprintHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeploymentTrialRecords");

            migrationBuilder.DropColumn(
                name: "ServerFingerprintHash",
                table: "DeploymentAnchors");
        }
    }
}
