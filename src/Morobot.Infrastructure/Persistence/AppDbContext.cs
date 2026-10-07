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
    public DbSet<ProcessTemplate> ProcessTemplates => Set<ProcessTemplate>();
    public DbSet<DataSource> DataSources => Set<DataSource>();
    public DbSet<DataSourceCell> DataSourceCells => Set<DataSourceCell>();
    public DbSet<ProcessDataSource> ProcessDataSources => Set<ProcessDataSource>();
    public DbSet<DeviceSession> DeviceSessions => Set<DeviceSession>();
    public DbSet<AppEventLog> EventLogs => Set<AppEventLog>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<DeploymentAnchor> DeploymentAnchors => Set<DeploymentAnchor>();
    public DbSet<DeploymentTrialRecord> DeploymentTrialRecords => Set<DeploymentTrialRecord>();
    public DbSet<StoredLicense> StoredLicenses => Set<StoredLicense>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<PaymentTransaction> PaymentTransactions => Set<PaymentTransaction>();
    public DbSet<SoftwarePackageOption> SoftwarePackageOptions => Set<SoftwarePackageOption>();
    public DbSet<LicensePricing> LicensePricings => Set<LicensePricing>();

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
            // Money needs an explicit precision or SQL Server silently truncates to the default
            // (18,2) and EF warns on every migration. Prices and discounts share the same shape.
            e.Property(x => x.MonthlyPrice).HasPrecision(18, 2);
            e.Property(x => x.MonthlyDiscountPercent).HasPrecision(5, 2);
            e.Property(x => x.YearlyPrice).HasPrecision(18, 2);
            e.Property(x => x.YearlyDiscountPercent).HasPrecision(5, 2);
            e.Property(x => x.PriceCurrency).HasMaxLength(10).IsRequired();
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
            // Name is denormalised on purpose: the row must still say who changed it after that
            // user is renamed or deleted, which a foreign key alone cannot express.
            e.Property(x => x.LastChangedByUserName).HasMaxLength(80);
        });

        modelBuilder.Entity<DeploymentAnchor>(e =>
        {
            e.ToTable("DeploymentAnchors");
            e.HasIndex(x => x.AnchorId).IsUnique();
            e.Property(x => x.MonotonicCounter).HasDefaultValue(0L);
            e.Property(x => x.ServerFingerprintHash).HasMaxLength(128).IsRequired();
        });

        modelBuilder.Entity<DeploymentTrialRecord>(e =>
        {
            e.ToTable("DeploymentTrialRecords");
            e.HasIndex(x => x.ServerFingerprintHash).IsUnique();
            e.Property(x => x.ServerFingerprintHash).HasMaxLength(128).IsRequired();
            e.Property(x => x.TrialDays).HasDefaultValue(3);
            e.Property(x => x.InstanceId).IsRequired();
            e.HasIndex(x => x.InstanceId).IsUnique();
        });

        modelBuilder.Entity<StoredLicense>(e =>
        {
            e.ToTable("StoredLicenses");
            e.Property(x => x.RawJson).HasColumnType("nvarchar(max)").IsRequired();
            e.Property(x => x.LicenseId).HasMaxLength(64).IsRequired();
            e.Property(x => x.OrganizationName).HasMaxLength(200);
            e.Property(x => x.DatabaseServerHint).HasMaxLength(200);
            e.Property(x => x.AllowedHost).HasMaxLength(253);
            e.Property(x => x.ReferralWidgetUrl).HasMaxLength(500);
            e.Property(x => x.TrialDays).HasDefaultValue(3);
            e.Property(x => x.AllowUpdates).HasDefaultValue(true);
            // Mirror of LicensePayload.AllowPlanManagement. Defaulted to true here as well as on the
            // CLR property so the database default and the model default agree — when they disagree
            // EF emits a spurious AlterColumn on the next migration.
            e.Property(x => x.AllowPlanManagement).HasDefaultValue(true);
            // Same mirror-and-default reasoning as AllowPlanManagement above.
            e.Property(x => x.AllowBilingual).HasDefaultValue(true);
            // Commerce flags are opt-in, so their database default is false — matching the CLR
            // default, for the same reason: a disagreement makes EF emit a spurious AlterColumn.
            e.Property(x => x.AllowCommerce).HasDefaultValue(false);
            e.Property(x => x.AllowSoftwarePurchase).HasDefaultValue(false);
            e.Property(x => x.AllowSelfIssuedLicenses).HasDefaultValue(false);
            e.Property(x => x.ServerBaseUrl).HasMaxLength(500);
            e.HasIndex(x => x.ImportedAtUtc);
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

        modelBuilder.Entity<Order>(e =>
        {
            e.ToTable("Orders");
            e.Property(x => x.ItemRef).HasMaxLength(100).IsRequired();
            e.Property(x => x.ItemTitle).HasMaxLength(200).IsRequired();
            e.Property(x => x.BillingCycle).HasMaxLength(20);
            e.Property(x => x.Currency).HasMaxLength(10).IsRequired();
            e.Property(x => x.FailureReason).HasMaxLength(500);
            // Money is decimal, never double: a price computed in binary floating point eventually
            // disagrees with the price the customer was shown, and this is the number a receipt is
            // built from. Precision matches Plan's price columns so the two cannot round differently.
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.PayableAmount).HasPrecision(18, 2);
            e.Property(x => x.DiscountAmount).HasPrecision(18, 2);
            // The history page reads "this user's orders, newest first", which is exactly this index.
            e.HasIndex(x => new { x.UserId, x.CreatedAtUtc });
            e.HasIndex(x => x.Status);
            // SetNull, not Cascade: deleting a user must not erase the record of what they were
            // charged — a financial history that disappears with the account is worse than useless.
            e.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<PaymentTransaction>(e =>
        {
            e.ToTable("PaymentTransactions");
            e.Property(x => x.Gateway).HasMaxLength(40).IsRequired();
            e.Property(x => x.Authority).HasMaxLength(120).IsRequired();
            e.Property(x => x.GatewayReference).HasMaxLength(120);
            e.Property(x => x.Currency).HasMaxLength(10).IsRequired();
            e.Property(x => x.Amount).HasPrecision(18, 2);
            // A gateway callback can arrive twice (a refresh, a retry, a duplicate webhook). This
            // index is what makes the second arrival find the existing row instead of paying again.
            e.HasIndex(x => new { x.Gateway, x.Authority }).IsUnique();
            e.HasOne(x => x.Order)
                .WithMany(x => x.Transactions)
                .HasForeignKey(x => x.OrderId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SoftwarePackageOption>(e =>
        {
            e.ToTable("SoftwarePackageOptions");
            e.Property(x => x.Key).HasMaxLength(60).IsRequired();
            e.Property(x => x.Title).HasMaxLength(200).IsRequired();
            e.Property(x => x.Description).HasMaxLength(500);
            e.Property(x => x.UnitLabel).HasMaxLength(40);
            e.Property(x => x.Amount).HasPrecision(18, 2);
            e.Property(x => x.UnitAmount).HasPrecision(18, 2);
            e.HasIndex(x => x.Key).IsUnique();
        });

        modelBuilder.Entity<LicensePricing>(e =>
        {
            e.ToTable("LicensePricings");
            e.Property(x => x.Currency).HasMaxLength(10).IsRequired();
            e.Property(x => x.BaseAmount).HasPrecision(18, 2);
            e.Property(x => x.PerUserAmount).HasPrecision(18, 2);
            e.Property(x => x.YearlyTermMultiplier).HasPrecision(18, 2);
            e.Property(x => x.PerpetualMultiplier).HasPrecision(18, 2);
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
            e.HasIndex(x => x.DeploymentInstanceId);
            e.Property(x => x.PreferredLanguage).HasMaxLength(10).HasDefaultValue("fa");
            e.Property(x => x.PasswordChangeRequired).HasDefaultValue(false);
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
            e.HasIndex(x => x.DeploymentInstanceId);
            e.Property(x => x.GraphJson);
            e.HasOne(x => x.Creator)
                .WithMany(x => x.CreatedProcesses)
                .HasForeignKey(x => x.CreatorUserId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.LastEditor)
                .WithMany()
                .HasForeignKey(x => x.LastEditorUserId)
                .OnDelete(DeleteBehavior.SetNull);

            // A process attached to a template inherits its graph, so the link must not silently
            // vanish. Deleting a template that still has processes on it is refused, forcing the
            // author to detach them deliberately instead of losing the link by accident.
            e.HasOne(x => x.Template)
                .WithMany(x => x.Processes)
                .HasForeignKey(x => x.TemplateId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.TemplateId);
        });

        modelBuilder.Entity<ProcessTemplate>(e =>
        {
            e.ToTable("ProcessTemplates");
            e.Property(x => x.Title).HasMaxLength(100).IsRequired();
            e.Property(x => x.Description).HasMaxLength(1000);
            e.Property(x => x.GraphJson);
            e.HasIndex(x => x.Title);
            e.HasOne(x => x.Creator)
                .WithMany()
                .HasForeignKey(x => x.CreatorUserId)
                .OnDelete(DeleteBehavior.SetNull);

            // The mother process. SetNull, not Cascade and not Restrict: deleting the mother must
            // leave the template and its children intact (they lose the badge and keep working),
            // and it must not be blocked either — a mother is an ordinary process and the user can
            // reasonably delete it. One-to-one because a process authors at most one template.
            //
            // The inverse navigation is declared so a query can go from the PROCESS to the template
            // it authored (`p.SourceOfTemplate`). That is the only way the list can mark the mother:
            // the mother itself carries no TemplateId, so without this the flag would be
            // unreachable and the mother would read as an ordinary standalone process.
            e.HasOne(x => x.SourceProcess)
                .WithOne(p => p.SourceOfTemplate)
                .HasForeignKey<ProcessTemplate>(x => x.SourceProcessId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => x.SourceProcessId);
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
            // Every public-source lookup filters on this, so it is worth its own index rather than
            // riding along on the owner one.
            e.HasIndex(x => x.IsPublic);
            e.HasOne(x => x.Owner)
                .WithMany()
                .HasForeignKey(x => x.OwnerUserId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.LastEditor)
                .WithMany()
                .HasForeignKey(x => x.LastEditorUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DataSourceCell>(e =>
        {
            e.ToTable("DataSourceCells");
            e.Property(x => x.ColumnKey).HasMaxLength(120).IsRequired();
            e.Property(x => x.CellValue).IsRequired();
            e.HasIndex(x => new { x.DataSourceId, x.RowIndex, x.ColumnKey }).IsUnique();
            // Cell provenance. NoAction (not SetNull): SQL Server rejects a second cascade path into
            // DataSourceCells, and deleting a user must not touch the data they entered — the
            // tooltip simply falls back to "unknown editor" when the id no longer resolves.
            e.HasOne<AppUser>()
                .WithMany()
                .HasForeignKey(x => x.LastEditorUserId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.NoAction);
            e.HasOne(x => x.DataSource)
                .WithMany(x => x.Cells)
                .HasForeignKey(x => x.DataSourceId)
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
