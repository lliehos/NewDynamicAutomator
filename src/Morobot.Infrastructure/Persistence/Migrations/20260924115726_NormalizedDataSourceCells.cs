using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NormalizedDataSourceCells : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "DataRevision",
                table: "DataSources",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "DataSourceCells",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    DataSourceId = table.Column<int>(type: "int", nullable: false),
                    RowIndex = table.Column<int>(type: "int", nullable: false),
                    ColumnKey = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    CellValue = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DataSourceCells", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DataSourceCells_DataSources_DataSourceId",
                        column: x => x.DataSourceId,
                        principalTable: "DataSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DataSourceCells_DataSourceId_RowIndex_ColumnKey",
                table: "DataSourceCells",
                columns: new[] { "DataSourceId", "RowIndex", "ColumnKey" },
                unique: true);

            migrationBuilder.AddColumn<long>(
                name: "CellRevision",
                table: "DataSourceCells",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "CellRevision", table: "DataSourceCells");
            migrationBuilder.DropTable(name: "DataSourceCells");
            migrationBuilder.DropColumn(name: "DataRevision", table: "DataSources");
        }
    }
}
