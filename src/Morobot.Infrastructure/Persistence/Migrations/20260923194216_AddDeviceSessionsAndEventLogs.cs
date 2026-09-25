using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeviceSessionsAndEventLogs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DeviceSessions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    FingerprintHash = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    ClaimedUserName = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    UserAgent = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: true),
                    Platform = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    Language = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true),
                    TimeZone = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    Screen = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true),
                    HardwareConcurrency = table.Column<int>(type: "int", nullable: true),
                    IpAddress = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    DetailsJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    FirstSeenUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    LastSeenUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    LoginCount = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeviceSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DeviceSessions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EventLogs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<int>(type: "int", nullable: true),
                    UserName = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    Level = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Category = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    EventType = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: false),
                    Message = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    DetailsJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    FingerprintHash = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    Path = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    IpAddress = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventLogs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EventLogs_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeviceSessions_UserId_FingerprintHash",
                table: "DeviceSessions",
                columns: new[] { "UserId", "FingerprintHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EventLogs_CreatedAtUtc",
                table: "EventLogs",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_EventLogs_Level_CreatedAtUtc",
                table: "EventLogs",
                columns: new[] { "Level", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_EventLogs_UserId",
                table: "EventLogs",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeviceSessions");

            migrationBuilder.DropTable(
                name: "EventLogs");
        }
    }
}
