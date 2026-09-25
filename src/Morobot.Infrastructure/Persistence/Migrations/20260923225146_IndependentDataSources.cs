using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class IndependentDataSources : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DataSources",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerUserId = table.Column<int>(type: "int", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(260)", maxLength: 260, nullable: true),
                    ColumnCount = table.Column<int>(type: "int", nullable: false),
                    RowCount = table.Column<int>(type: "int", nullable: false),
                    ColumnsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CellsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DataSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DataSources_Users_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProcessDataSources",
                columns: table => new
                {
                    ProcessId = table.Column<int>(type: "int", nullable: false),
                    DataSourceId = table.Column<int>(type: "int", nullable: false),
                    IsDefault = table.Column<bool>(type: "bit", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProcessDataSources", x => new { x.ProcessId, x.DataSourceId });
                    table.ForeignKey(
                        name: "FK_ProcessDataSources_DataSources_DataSourceId",
                        column: x => x.DataSourceId,
                        principalTable: "DataSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProcessDataSources_Processes_ProcessId",
                        column: x => x.ProcessId,
                        principalTable: "Processes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DataSources_OwnerUserId",
                table: "DataSources",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ProcessDataSources_DataSourceId",
                table: "ProcessDataSources",
                column: "DataSourceId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProcessDataSources");

            migrationBuilder.DropTable(
                name: "DataSources");
        }
    }
}
