using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddProcessSharing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CanChangeDataSource",
                table: "UserTasks",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanDelete",
                table: "UserTasks",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanEdit",
                table: "UserTasks",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanExecute",
                table: "UserTasks",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "CanView",
                table: "UserTasks",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "GrantedAtUtc",
                table: "UserTasks",
                type: "datetime2",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<int>(
                name: "GrantedByUserId",
                table: "UserTasks",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NationalId",
                table: "Users",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "CanShare",
                table: "Plans",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "MaxSharesPerTask",
                table: "Plans",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ShareAllowChangeDataSource",
                table: "Plans",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ShareAllowDelete",
                table: "Plans",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ShareAllowEdit",
                table: "Plans",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ShareAllowExecute",
                table: "Plans",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ShareAllowView",
                table: "Plans",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_Users_NationalId",
                table: "Users",
                column: "NationalId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Users_NationalId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CanChangeDataSource",
                table: "UserTasks");

            migrationBuilder.DropColumn(
                name: "CanDelete",
                table: "UserTasks");

            migrationBuilder.DropColumn(
                name: "CanEdit",
                table: "UserTasks");

            migrationBuilder.DropColumn(
                name: "CanExecute",
                table: "UserTasks");

            migrationBuilder.DropColumn(
                name: "CanView",
                table: "UserTasks");

            migrationBuilder.DropColumn(
                name: "GrantedAtUtc",
                table: "UserTasks");

            migrationBuilder.DropColumn(
                name: "GrantedByUserId",
                table: "UserTasks");

            migrationBuilder.DropColumn(
                name: "NationalId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CanShare",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "MaxSharesPerTask",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "ShareAllowChangeDataSource",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "ShareAllowDelete",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "ShareAllowEdit",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "ShareAllowExecute",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "ShareAllowView",
                table: "Plans");
        }
    }
}
