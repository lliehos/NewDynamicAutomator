using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Morobot.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CanvasFirstProcesses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Drop relational graph / excel (canvas backfill runs in Program before Migrate).
            migrationBuilder.Sql(@"
IF OBJECT_ID(N'[dbo].[Conditions]', N'U') IS NOT NULL DROP TABLE [dbo].[Conditions];
IF OBJECT_ID(N'[dbo].[DataSourceCells]', N'U') IS NOT NULL DROP TABLE [dbo].[DataSourceCells];
IF OBJECT_ID(N'[dbo].[TaskDataSources]', N'U') IS NOT NULL DROP TABLE [dbo].[TaskDataSources];
IF OBJECT_ID(N'[dbo].[ConditionGroups]', N'U') IS NOT NULL DROP TABLE [dbo].[ConditionGroups];
IF OBJECT_ID(N'[dbo].[Steps]', N'U') IS NOT NULL DROP TABLE [dbo].[Steps];
IF OBJECT_ID(N'[dbo].[Actions]', N'U') IS NOT NULL DROP TABLE [dbo].[Actions];
IF OBJECT_ID(N'[dbo].[Groups]', N'U') IS NOT NULL DROP TABLE [dbo].[Groups];
IF OBJECT_ID(N'[dbo].[Selectors]', N'U') IS NOT NULL DROP TABLE [dbo].[Selectors];
IF OBJECT_ID(N'[dbo].[DataSources]', N'U') IS NOT NULL DROP TABLE [dbo].[DataSources];
");

            migrationBuilder.Sql(@"
-- Preserve process + share rows via rename
IF OBJECT_ID(N'[dbo].[Tasks]', N'U') IS NOT NULL AND OBJECT_ID(N'[dbo].[Processes]', N'U') IS NULL
BEGIN
    UPDATE [dbo].[UserTasks] SET CanEdit = 1, CanView = 1 WHERE CanModify = 1 AND CanEdit = 0;

    ALTER TABLE [dbo].[UserTasks] DROP CONSTRAINT [FK_UserTasks_Tasks_TaskId];
    ALTER TABLE [dbo].[UserTasks] DROP CONSTRAINT [FK_UserTasks_Users_UserId];
    ALTER TABLE [dbo].[Tasks] DROP CONSTRAINT [FK_Tasks_Users_CreatorUserId];

    DROP INDEX [IX_UserTasks_UserId_TaskId] ON [dbo].[UserTasks];
    DROP INDEX [IX_UserTasks_TaskId] ON [dbo].[UserTasks];
    DROP INDEX [IX_Tasks_CreatorUserId] ON [dbo].[Tasks];

    ALTER TABLE [dbo].[UserTasks] DROP COLUMN [CanModify];
    ALTER TABLE [dbo].[Tasks] DROP COLUMN [CopyFromId];
    ALTER TABLE [dbo].[Tasks] DROP COLUMN [UseGlobalDataSources];

    EXEC sp_rename N'[dbo].[Tasks].[CanvasJson]', N'GraphJson', N'COLUMN';
    EXEC sp_rename N'[dbo].[UserTasks].[TaskId]', N'ProcessId', N'COLUMN';
    EXEC sp_rename N'[dbo].[Tasks]', N'Processes';
    EXEC sp_rename N'[dbo].[UserTasks]', N'ProcessShares';
    EXEC sp_rename N'[dbo].[PK_Tasks]', N'PK_Processes';
    EXEC sp_rename N'[dbo].[PK_UserTasks]', N'PK_ProcessShares';

    ALTER TABLE [dbo].[Processes] WITH CHECK ADD CONSTRAINT [FK_Processes_Users_CreatorUserId]
        FOREIGN KEY([CreatorUserId]) REFERENCES [dbo].[Users]([Id]) ON DELETE SET NULL;
    ALTER TABLE [dbo].[ProcessShares] WITH CHECK ADD CONSTRAINT [FK_ProcessShares_Processes_ProcessId]
        FOREIGN KEY([ProcessId]) REFERENCES [dbo].[Processes]([Id]) ON DELETE CASCADE;
    ALTER TABLE [dbo].[ProcessShares] WITH CHECK ADD CONSTRAINT [FK_ProcessShares_Users_UserId]
        FOREIGN KEY([UserId]) REFERENCES [dbo].[Users]([Id]) ON DELETE CASCADE;

    CREATE INDEX [IX_Processes_CreatorUserId] ON [dbo].[Processes]([CreatorUserId]);
    CREATE INDEX [IX_ProcessShares_ProcessId] ON [dbo].[ProcessShares]([ProcessId]);
    CREATE UNIQUE INDEX [IX_ProcessShares_UserId_ProcessId] ON [dbo].[ProcessShares]([UserId], [ProcessId]);
END
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new InvalidOperationException(
                "Canvas-first migration cannot be reversed automatically. Restore from DB backup.");
        }
    }
}
