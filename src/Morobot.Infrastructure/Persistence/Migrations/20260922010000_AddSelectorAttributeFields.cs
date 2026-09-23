using Morobot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260922010000_AddSelectorAttributeFields")]
public partial class AddSelectorAttributeFields : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(
            name: "HasAttribute",
            table: "Selectors",
            type: "bit",
            nullable: false,
            defaultValue: false);

        migrationBuilder.AddColumn<string>(
            name: "AttributeName",
            table: "Selectors",
            type: "nvarchar(100)",
            maxLength: 100,
            nullable: true);

        migrationBuilder.AddColumn<bool>(
            name: "AttributeValueIsDynamic",
            table: "Selectors",
            type: "bit",
            nullable: false,
            defaultValue: false);

        migrationBuilder.AddColumn<string>(
            name: "AttributeValue",
            table: "Selectors",
            type: "nvarchar(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "AttributeDynamicColumn",
            table: "Selectors",
            type: "nvarchar(100)",
            maxLength: 100,
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "AttributeDataSourceId",
            table: "Selectors",
            type: "int",
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "HasAttribute", table: "Selectors");
        migrationBuilder.DropColumn(name: "AttributeName", table: "Selectors");
        migrationBuilder.DropColumn(name: "AttributeValueIsDynamic", table: "Selectors");
        migrationBuilder.DropColumn(name: "AttributeValue", table: "Selectors");
        migrationBuilder.DropColumn(name: "AttributeDynamicColumn", table: "Selectors");
        migrationBuilder.DropColumn(name: "AttributeDataSourceId", table: "Selectors");
    }
}
