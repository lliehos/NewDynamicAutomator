using Morobot.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Persistence;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Plan> Plans => Set<Plan>();
    public DbSet<PlanPrice> PlanPrices => Set<PlanPrice>();
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
    public DbSet<DeviceSession> DeviceSessions => Set<DeviceSession>();
    public DbSet<AppEventLog> EventLogs => Set<AppEventLog>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DeviceSession>(e =>
        {
            e.ToTable("DeviceSessions");
            e.HasIndex(x => new { x.UserId, x.FingerprintHash }).IsUnique();
            e.Property(x => x.FingerprintHash).HasMaxLength(128).IsRequired();
            e.Property(x => x.MachineFingerprint).HasMaxLength(128);
            e.HasIndex(x => x.MachineFingerprint);
            e.Property(x => x.ClaimedUserName).HasMaxLength(80);
            e.Property(x => x.UserAgent).HasMaxLength(512);
            e.Property(x => x.Platform).HasMaxLength(120);
            e.Property(x => x.Language).HasMaxLength(40);
            e.Property(x => x.TimeZone).HasMaxLength(80);
            e.Property(x => x.Screen).HasMaxLength(40);
            e.Property(x => x.IpAddress).HasMaxLength(64);
            e.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AppEventLog>(e =>
        {
            e.ToTable("EventLogs");
            e.HasIndex(x => x.CreatedAtUtc);
            e.HasIndex(x => new { x.Level, x.CreatedAtUtc });
            e.Property(x => x.Level).HasMaxLength(20).IsRequired();
            e.Property(x => x.Category).HasMaxLength(40).IsRequired();
            e.Property(x => x.EventType).HasMaxLength(80).IsRequired();
            e.Property(x => x.Message).HasMaxLength(2000).IsRequired();
            e.Property(x => x.UserName).HasMaxLength(80);
            e.Property(x => x.FingerprintHash).HasMaxLength(128);
            e.Property(x => x.Path).HasMaxLength(400);
            e.Property(x => x.IpAddress).HasMaxLength(64);
            e.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Plan>(e =>
        {
            e.ToTable("Plans");
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Code).HasMaxLength(40).IsRequired();
            e.Property(x => x.NameFa).HasMaxLength(80).IsRequired();
            e.Property(x => x.NameEn).HasMaxLength(80).IsRequired();
            e.Property(x => x.MinPasswordLength).HasDefaultValue(3);
        });

        modelBuilder.Entity<SystemSetting>(e =>
        {
            e.ToTable("SystemSettings");
            e.HasIndex(x => x.Key).IsUnique();
            e.Property(x => x.Key).HasMaxLength(80).IsRequired();
            e.Property(x => x.Value).HasMaxLength(2000).IsRequired();
            e.Property(x => x.Group).HasMaxLength(40).IsRequired();
            e.Property(x => x.LabelFa).HasMaxLength(120).IsRequired();
            e.Property(x => x.LabelEn).HasMaxLength(120).IsRequired();
            e.Property(x => x.HintFa).HasMaxLength(500);
            e.Property(x => x.HintEn).HasMaxLength(500);
        });

        modelBuilder.Entity<PlanPrice>(e =>
        {
            e.ToTable("PlanPrices");
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.Currency).HasMaxLength(10).IsRequired();
            e.Property(x => x.Interval).HasMaxLength(30).IsRequired();
            e.Property(x => x.Notes).HasMaxLength(500);
            e.HasOne(x => x.Plan)
                .WithMany(x => x.Prices)
                .HasForeignKey(x => x.PlanId)
                .OnDelete(DeleteBehavior.Cascade);
        });

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
            e.Property(x => x.NationalId).HasMaxLength(20);
            e.HasIndex(x => x.NationalId);
            e.Property(x => x.PreferredLanguage).HasMaxLength(10).HasDefaultValue("fa");
            e.Property(x => x.Role).HasConversion<int>();
            e.HasOne(x => x.Plan)
                .WithMany(x => x.Users)
                .HasForeignKey(x => x.PlanId)
                .OnDelete(DeleteBehavior.SetNull);
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
