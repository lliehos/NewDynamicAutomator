using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DynamicAutomator.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserName = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    PasswordHash = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    FirstName = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    LastName = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    AppVersion = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "DataSources",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Title = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: true),
                    IsGlobal = table.Column<bool>(type: "bit", nullable: false),
                    IsInsertable = table.Column<bool>(type: "bit", nullable: false),
                    IsMergable = table.Column<bool>(type: "bit", nullable: false),
                    IsEditable = table.Column<bool>(type: "bit", nullable: false),
                    IsPopable = table.Column<bool>(type: "bit", nullable: false),
                    CopyFromId = table.Column<int>(type: "int", nullable: true),
                    ColumnsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DataSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DataSources_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Tasks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Title = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    DelayBeforeMs = table.Column<int>(type: "int", nullable: false),
                    DelayAfterMs = table.Column<int>(type: "int", nullable: false),
                    CreatorUserId = table.Column<int>(type: "int", nullable: true),
                    LastExecutedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    LastExecuteUserId = table.Column<int>(type: "int", nullable: true),
                    CopyFromId = table.Column<int>(type: "int", nullable: true),
                    UseGlobalDataSources = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Tasks_Users_CreatorUserId",
                        column: x => x.CreatorUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "DataSourceCells",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    DataSourceId = table.Column<int>(type: "int", nullable: false),
                    RowIndex = table.Column<int>(type: "int", nullable: false),
                    ColumnName = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
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

            migrationBuilder.CreateTable(
                name: "Selectors",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ElementBy = table.Column<int>(type: "int", nullable: false),
                    ElementValue = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    FramePathJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    MinDuration = table.Column<int>(type: "int", nullable: true),
                    MaxDuration = table.Column<int>(type: "int", nullable: true),
                    TryTimes = table.Column<int>(type: "int", nullable: true),
                    TryDelay = table.Column<int>(type: "int", nullable: true),
                    ElementDisplayed = table.Column<bool>(type: "bit", nullable: false),
                    ElementEnabled = table.Column<bool>(type: "bit", nullable: false),
                    ApplyElementState = table.Column<bool>(type: "bit", nullable: false),
                    IsDynamic = table.Column<bool>(type: "bit", nullable: false),
                    DynamicSourceColumnName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    ElementSourceId = table.Column<int>(type: "int", nullable: true),
                    IsInShadowRoot = table.Column<bool>(type: "bit", nullable: false),
                    ShadowSelector = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    IsIndexDependent = table.Column<bool>(type: "bit", nullable: false),
                    CopyFromId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Selectors", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Selectors_DataSources_ElementSourceId",
                        column: x => x.ElementSourceId,
                        principalTable: "DataSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "TaskDataSources",
                columns: table => new
                {
                    DataSourcesId = table.Column<int>(type: "int", nullable: false),
                    TasksId = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskDataSources", x => new { x.DataSourcesId, x.TasksId });
                    table.ForeignKey(
                        name: "FK_TaskDataSources_DataSources_DataSourcesId",
                        column: x => x.DataSourcesId,
                        principalTable: "DataSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TaskDataSources_Tasks_TasksId",
                        column: x => x.TasksId,
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserTasks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    TaskId = table.Column<int>(type: "int", nullable: false),
                    CanModify = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserTasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserTasks_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserTasks_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Actions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ActionType = table.Column<int>(type: "int", nullable: false),
                    ConstantValue = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    NavigateUrl = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    WaitTimeDuration = table.Column<int>(type: "int", nullable: true),
                    ContentSourceType = table.Column<int>(type: "int", nullable: false),
                    DynamicSourceColumnName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    SelectorId = table.Column<int>(type: "int", nullable: true),
                    OnFailedType = table.Column<int>(type: "int", nullable: false),
                    FailedRetryTimes = table.Column<byte>(type: "tinyint", nullable: true),
                    OnFailedStepId = table.Column<int>(type: "int", nullable: true),
                    FailedDelayBeforeRetry = table.Column<int>(type: "int", nullable: true),
                    SaveSourceId = table.Column<int>(type: "int", nullable: true),
                    RowIndexType = table.Column<int>(type: "int", nullable: false),
                    ColumnsCount = table.Column<int>(type: "int", nullable: true),
                    CopyFromId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Actions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Actions_DataSources_SaveSourceId",
                        column: x => x.SaveSourceId,
                        principalTable: "DataSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Actions_Selectors_SelectorId",
                        column: x => x.SelectorId,
                        principalTable: "Selectors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Groups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Title = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    TaskId = table.Column<int>(type: "int", nullable: false),
                    ParentGroupId = table.Column<int>(type: "int", nullable: true),
                    Priority = table.Column<int>(type: "int", nullable: false),
                    DataSourceId = table.Column<int>(type: "int", nullable: true),
                    SelectorId = table.Column<int>(type: "int", nullable: true),
                    SourceType = table.Column<int>(type: "int", nullable: false),
                    MoveLoop = table.Column<bool>(type: "bit", nullable: false),
                    CopyFromId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Groups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Groups_DataSources_DataSourceId",
                        column: x => x.DataSourceId,
                        principalTable: "DataSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Groups_Groups_ParentGroupId",
                        column: x => x.ParentGroupId,
                        principalTable: "Groups",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Groups_Selectors_SelectorId",
                        column: x => x.SelectorId,
                        principalTable: "Selectors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Groups_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Steps",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Title = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    GroupId = table.Column<int>(type: "int", nullable: true),
                    Priority = table.Column<int>(type: "int", nullable: false),
                    ActionId = table.Column<int>(type: "int", nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    IsConditional = table.Column<bool>(type: "bit", nullable: false),
                    CopyFromId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Steps", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Steps_Actions_ActionId",
                        column: x => x.ActionId,
                        principalTable: "Actions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Steps_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ConditionGroups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    StepId = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    SuccessGroupId = table.Column<int>(type: "int", nullable: true),
                    FailedGroupId = table.Column<int>(type: "int", nullable: true),
                    BreakLoopOnFailed = table.Column<bool>(type: "bit", nullable: true),
                    BreakLoopOnSuccess = table.Column<bool>(type: "bit", nullable: true),
                    CopyFromId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConditionGroups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ConditionGroups_Groups_FailedGroupId",
                        column: x => x.FailedGroupId,
                        principalTable: "Groups",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ConditionGroups_Groups_SuccessGroupId",
                        column: x => x.SuccessGroupId,
                        principalTable: "Groups",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ConditionGroups_Steps_StepId",
                        column: x => x.StepId,
                        principalTable: "Steps",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Conditions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ConditionGroupId = table.Column<int>(type: "int", nullable: false),
                    ConditionType = table.Column<int>(type: "int", nullable: false),
                    Duration = table.Column<int>(type: "int", nullable: true),
                    Navigation = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    SelectorId = table.Column<int>(type: "int", nullable: true),
                    IsOr = table.Column<bool>(type: "bit", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    ConstantEqualValue = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    ContentSourceType = table.Column<int>(type: "int", nullable: false),
                    DynamicSourceColumnName = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    EqualityType = table.Column<int>(type: "int", nullable: false),
                    SourceId = table.Column<int>(type: "int", nullable: true),
                    CopyFromId = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Conditions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Conditions_ConditionGroups_ConditionGroupId",
                        column: x => x.ConditionGroupId,
                        principalTable: "ConditionGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Conditions_DataSources_SourceId",
                        column: x => x.SourceId,
                        principalTable: "DataSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Conditions_Selectors_SelectorId",
                        column: x => x.SelectorId,
                        principalTable: "Selectors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Actions_SaveSourceId",
                table: "Actions",
                column: "SaveSourceId");

            migrationBuilder.CreateIndex(
                name: "IX_Actions_SelectorId",
                table: "Actions",
                column: "SelectorId");

            migrationBuilder.CreateIndex(
                name: "IX_ConditionGroups_FailedGroupId",
                table: "ConditionGroups",
                column: "FailedGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_ConditionGroups_StepId",
                table: "ConditionGroups",
                column: "StepId");

            migrationBuilder.CreateIndex(
                name: "IX_ConditionGroups_SuccessGroupId",
                table: "ConditionGroups",
                column: "SuccessGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_Conditions_ConditionGroupId",
                table: "Conditions",
                column: "ConditionGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_Conditions_SelectorId",
                table: "Conditions",
                column: "SelectorId");

            migrationBuilder.CreateIndex(
                name: "IX_Conditions_SourceId",
                table: "Conditions",
                column: "SourceId");

            migrationBuilder.CreateIndex(
                name: "IX_DataSourceCells_DataSourceId_RowIndex_ColumnName",
                table: "DataSourceCells",
                columns: new[] { "DataSourceId", "RowIndex", "ColumnName" });

            migrationBuilder.CreateIndex(
                name: "IX_DataSources_UserId",
                table: "DataSources",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Groups_DataSourceId",
                table: "Groups",
                column: "DataSourceId");

            migrationBuilder.CreateIndex(
                name: "IX_Groups_ParentGroupId",
                table: "Groups",
                column: "ParentGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_Groups_SelectorId",
                table: "Groups",
                column: "SelectorId");

            migrationBuilder.CreateIndex(
                name: "IX_Groups_TaskId",
                table: "Groups",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_Selectors_ElementSourceId",
                table: "Selectors",
                column: "ElementSourceId");

            migrationBuilder.CreateIndex(
                name: "IX_Steps_ActionId",
                table: "Steps",
                column: "ActionId");

            migrationBuilder.CreateIndex(
                name: "IX_Steps_GroupId",
                table: "Steps",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_TaskDataSources_TasksId",
                table: "TaskDataSources",
                column: "TasksId");

            migrationBuilder.CreateIndex(
                name: "IX_Tasks_CreatorUserId",
                table: "Tasks",
                column: "CreatorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_UserName",
                table: "Users",
                column: "UserName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserTasks_TaskId",
                table: "UserTasks",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_UserTasks_UserId_TaskId",
                table: "UserTasks",
                columns: new[] { "UserId", "TaskId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Conditions");

            migrationBuilder.DropTable(
                name: "DataSourceCells");

            migrationBuilder.DropTable(
                name: "TaskDataSources");

            migrationBuilder.DropTable(
                name: "UserTasks");

            migrationBuilder.DropTable(
                name: "ConditionGroups");

            migrationBuilder.DropTable(
                name: "Steps");

            migrationBuilder.DropTable(
                name: "Actions");

            migrationBuilder.DropTable(
                name: "Groups");

            migrationBuilder.DropTable(
                name: "Selectors");

            migrationBuilder.DropTable(
                name: "Tasks");

            migrationBuilder.DropTable(
                name: "DataSources");

            migrationBuilder.DropTable(
                name: "Users");
        }
    }
}
