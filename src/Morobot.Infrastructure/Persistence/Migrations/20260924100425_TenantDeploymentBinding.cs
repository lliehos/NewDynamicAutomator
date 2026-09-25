using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TenantDeploymentBinding : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DeploymentInstanceId",
                table: "Users",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeploymentInstanceId",
                table: "Processes",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "InstanceId",
                table: "DeploymentTrialRecords",
                type: "uniqueidentifier",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateIndex(
                name: "IX_Users_DeploymentInstanceId",
                table: "Users",
                column: "DeploymentInstanceId");

            migrationBuilder.CreateIndex(
                name: "IX_Processes_DeploymentInstanceId",
                table: "Processes",
                column: "DeploymentInstanceId");

            migrationBuilder.CreateIndex(
                name: "IX_DeploymentTrialRecords_InstanceId",
                table: "DeploymentTrialRecords",
                column: "InstanceId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Users_DeploymentInstanceId",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_Processes_DeploymentInstanceId",
                table: "Processes");

            migrationBuilder.DropIndex(
                name: "IX_DeploymentTrialRecords_InstanceId",
                table: "DeploymentTrialRecords");

            migrationBuilder.DropColumn(
                name: "DeploymentInstanceId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "DeploymentInstanceId",
                table: "Processes");

            migrationBuilder.DropColumn(
                name: "InstanceId",
                table: "DeploymentTrialRecords");
        }
    }
}
