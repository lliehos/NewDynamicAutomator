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
    public DbSet<Process> Processes => Set<Process>();
    public DbSet<ProcessShare> ProcessShares => Set<ProcessShare>();
    public DbSet<DataSource> DataSources => Set<DataSource>();
    public DbSet<ProcessDataSource> ProcessDataSources => Set<ProcessDataSource>();
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

        modelBuilder.Entity<Process>(e =>
        {
            e.ToTable("Processes");
            e.Property(x => x.Title).HasMaxLength(100).IsRequired();
            e.Property(x => x.GraphJson);
            e.HasOne(x => x.Creator)
                .WithMany(x => x.CreatedProcesses)
                .HasForeignKey(x => x.CreatorUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<ProcessShare>(e =>
        {
            e.ToTable("ProcessShares");
            e.HasIndex(x => new { x.UserId, x.ProcessId }).IsUnique();
            e.HasOne(x => x.User)
                .WithMany(x => x.ProcessShares)
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Process)
                .WithMany(x => x.Shares)
                .HasForeignKey(x => x.ProcessId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DataSource>(e =>
        {
            e.ToTable("DataSources");
            e.Property(x => x.Title).HasMaxLength(200).IsRequired();
            e.Property(x => x.FileName).HasMaxLength(260);
            e.Property(x => x.ColumnsJson).IsRequired();
            e.Property(x => x.CellsJson).IsRequired();
            e.HasIndex(x => x.OwnerUserId);
            e.HasOne(x => x.Owner)
                .WithMany()
                .HasForeignKey(x => x.OwnerUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ProcessDataSource>(e =>
        {
            e.ToTable("ProcessDataSources");
            e.HasKey(x => new { x.ProcessId, x.DataSourceId });
            e.HasOne(x => x.Process)
                .WithMany(x => x.DataSourceLinks)
                .HasForeignKey(x => x.ProcessId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.DataSource)
                .WithMany(x => x.ProcessLinks)
                .HasForeignKey(x => x.DataSourceId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.DataSourceId);
        });
    }
}
