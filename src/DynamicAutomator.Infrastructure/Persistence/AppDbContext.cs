using DynamicAutomator.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace DynamicAutomator.Infrastructure.Persistence;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<AutomationTask> Tasks => Set<AutomationTask>();
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<Step> Steps => Set<Step>();
    public DbSet<StepAction> Actions => Set<StepAction>();
    public DbSet<ConditionGroup> ConditionGroups => Set<ConditionGroup>();
    public DbSet<Condition> Conditions => Set<Condition>();
    public DbSet<Selector> Selectors => Set<Selector>();
    public DbSet<DataSource> DataSources => Set<DataSource>();
    public DbSet<DataSourceCell> DataSourceCells => Set<DataSourceCell>();
    public DbSet<UserTaskAccess> UserTaskAccess => Set<UserTaskAccess>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>(e =>
        {
            e.ToTable("Users");
            e.HasIndex(x => x.UserName).IsUnique();
            e.Property(x => x.UserName).HasMaxLength(50).IsRequired();
            e.Property(x => x.PasswordHash).HasMaxLength(500).IsRequired();
            e.Property(x => x.FirstName).HasMaxLength(50);
            e.Property(x => x.LastName).HasMaxLength(50);
            e.Property(x => x.Email).HasMaxLength(120);
            e.Property(x => x.Mobile).HasMaxLength(30);
            e.Property(x => x.PreferredLanguage).HasMaxLength(10).HasDefaultValue("fa");
        });

        modelBuilder.Entity<AutomationTask>(e =>
        {
            e.ToTable("Tasks");
            e.Property(x => x.Title).HasMaxLength(100).IsRequired();
            e.Property(x => x.CanvasJson);
            e.HasOne(x => x.Creator)
                .WithMany(x => x.CreatedTasks)
                .HasForeignKey(x => x.CreatorUserId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasMany(x => x.DataSources)
                .WithMany(x => x.Tasks)
                .UsingEntity(j => j.ToTable("TaskDataSources"));
        });

        modelBuilder.Entity<Group>(e =>
        {
            e.ToTable("Groups");
            e.Property(x => x.Title).HasMaxLength(50).IsRequired();
            e.HasOne(x => x.Task)
                .WithMany(x => x.Groups)
                .HasForeignKey(x => x.TaskId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.ParentGroup)
                .WithMany(x => x.ChildGroups)
                .HasForeignKey(x => x.ParentGroupId)
                .OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.DataSource)
                .WithMany(x => x.Groups)
                .HasForeignKey(x => x.DataSourceId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Selector)
                .WithMany(x => x.Groups)
                .HasForeignKey(x => x.SelectorId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Step>(e =>
        {
            e.ToTable("Steps");
            e.Property(x => x.Title).HasMaxLength(50).IsRequired();
            e.HasOne(x => x.Group)
                .WithMany(x => x.Steps)
                .HasForeignKey(x => x.GroupId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Action)
                .WithMany(x => x.Steps)
                .HasForeignKey(x => x.ActionId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<StepAction>(e =>
        {
            e.ToTable("Actions");
            e.HasOne(x => x.Selector)
                .WithMany(x => x.Actions)
                .HasForeignKey(x => x.SelectorId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.SaveSource)
                .WithMany(x => x.Actions)
                .HasForeignKey(x => x.SaveSourceId)
                .OnDelete(DeleteBehavior.SetNull);
            e.Property(x => x.ConstantValue).HasMaxLength(2000);
            e.Property(x => x.NavigateUrl).HasMaxLength(500);
            e.Property(x => x.DynamicSourceColumnName).HasMaxLength(100);
        });

        modelBuilder.Entity<ConditionGroup>(e =>
        {
            e.ToTable("ConditionGroups");
            e.Property(x => x.Title).HasMaxLength(50).IsRequired();
            e.HasOne(x => x.Step)
                .WithMany(x => x.ConditionGroups)
                .HasForeignKey(x => x.StepId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.SuccessGroup)
                .WithMany(x => x.SuccessConditionGroups)
                .HasForeignKey(x => x.SuccessGroupId)
                .OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.FailedGroup)
                .WithMany(x => x.FailedConditionGroups)
                .HasForeignKey(x => x.FailedGroupId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        modelBuilder.Entity<Condition>(e =>
        {
            e.ToTable("Conditions");
            e.HasOne(x => x.ConditionGroup)
                .WithMany(x => x.Conditions)
                .HasForeignKey(x => x.ConditionGroupId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Selector)
                .WithMany(x => x.Conditions)
                .HasForeignKey(x => x.SelectorId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Source)
                .WithMany(x => x.Conditions)
                .HasForeignKey(x => x.SourceId)
                .OnDelete(DeleteBehavior.SetNull);
            e.Property(x => x.Navigation).HasMaxLength(500);
            e.Property(x => x.ConstantEqualValue).HasMaxLength(200);
        });

        modelBuilder.Entity<Selector>(e =>
        {
            e.ToTable("Selectors");
            e.Property(x => x.ElementValue).HasMaxLength(2000).IsRequired();
            e.Property(x => x.FramePathJson).IsRequired();
            e.Property(x => x.DynamicSourceColumnName).HasMaxLength(100);
            e.Property(x => x.AttributeName).HasMaxLength(100);
            e.Property(x => x.AttributeValue).HasMaxLength(500);
            e.Property(x => x.AttributeDynamicColumn).HasMaxLength(100);
            e.Property(x => x.ShadowSelector).HasMaxLength(500);
            e.HasOne(x => x.ElementSource)
                .WithMany(x => x.Selectors)
                .HasForeignKey(x => x.ElementSourceId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DataSource>(e =>
        {
            e.ToTable("DataSources");
            e.Property(x => x.Title).HasMaxLength(50).IsRequired();
            e.Property(x => x.ColumnsJson).IsRequired();
            e.Property(x => x.RowVersion).IsRowVersion();
            e.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DataSourceCell>(e =>
        {
            e.ToTable("DataSourceCells");
            e.Property(x => x.ColumnName).HasMaxLength(50).IsRequired();
            e.HasOne(x => x.DataSource)
                .WithMany(x => x.Cells)
                .HasForeignKey(x => x.DataSourceId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.DataSourceId, x.RowIndex, x.ColumnName });
        });

        modelBuilder.Entity<UserTaskAccess>(e =>
        {
            e.ToTable("UserTasks");
            e.HasIndex(x => new { x.UserId, x.TaskId }).IsUnique();
            e.HasOne(x => x.User)
                .WithMany(x => x.TaskAccess)
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Task)
                .WithMany(x => x.UserAccess)
                .HasForeignKey(x => x.TaskId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
