using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEnterpriseLicensing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DeploymentAnchors",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AnchorId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    MonotonicCounter = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    LastTrustedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeploymentAnchors", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "StoredLicenses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RawJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    LicenseId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    ValidUntilUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    MaxUsers = table.Column<int>(type: "int", nullable: true),
                    OrganizationName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    ImportedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StoredLicenses", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeploymentAnchors_AnchorId",
                table: "DeploymentAnchors",
                column: "AnchorId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StoredLicenses_ImportedAtUtc",
                table: "StoredLicenses",
                column: "ImportedAtUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeploymentAnchors");

            migrationBuilder.DropTable(
                name: "StoredLicenses");
        }
    }
}
