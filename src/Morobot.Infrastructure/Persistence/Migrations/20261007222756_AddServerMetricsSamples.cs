using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddServerMetricsSamples : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ServerMetricsSamples",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CapturedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ProcessWorkingSetBytes = table.Column<long>(type: "bigint", nullable: false),
                    ProcessPrivateBytes = table.Column<long>(type: "bigint", nullable: false),
                    AvailablePhysicalBytes = table.Column<long>(type: "bigint", nullable: false),
                    TotalPhysicalBytes = table.Column<long>(type: "bigint", nullable: false),
                    ManagedHeapBytes = table.Column<long>(type: "bigint", nullable: false),
                    ProcessorSeconds = table.Column<double>(type: "float", nullable: false),
                    ThreadCount = table.Column<int>(type: "int", nullable: false),
                    Gen2Collections = table.Column<int>(type: "int", nullable: false),
                    DiskReadBytes = table.Column<long>(type: "bigint", nullable: false),
                    DiskWriteBytes = table.Column<long>(type: "bigint", nullable: false),
                    NetworkReceivedBytes = table.Column<long>(type: "bigint", nullable: false),
                    NetworkSentBytes = table.Column<long>(type: "bigint", nullable: false),
                    LiveSessions = table.Column<int>(type: "int", nullable: false),
                    OnlineUsers = table.Column<int>(type: "int", nullable: false),
                    EventsLastMinute = table.Column<int>(type: "int", nullable: false),
                    ProblemEventsLastMinute = table.Column<int>(type: "int", nullable: false),
                    DatabasePingMs = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServerMetricsSamples", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ServerMetricsSamples_CapturedAtUtc",
                table: "ServerMetricsSamples",
                column: "CapturedAtUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ServerMetricsSamples");
        }
    }
}
