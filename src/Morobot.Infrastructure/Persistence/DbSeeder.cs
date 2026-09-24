using Morobot.Contracts.Licensing;
using Morobot.Domain;
using Morobot.Domain.Entities;
using Morobot.Domain.Enums;
using Morobot.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Morobot.Infrastructure.Persistence;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        await EnsurePlansAsync(db);
        await EnsureSystemSettingsAsync(db);
        await EnsureUsersAsync(db);
    }

    private static async Task EnsurePlansAsync(AppDbContext db)
    {
        async Task UpsertPlan(
            string code, string fa, string en, int? maxTasks, int? maxSources, int? maxSteps,
            bool play, bool selector, bool record, bool smart, int sort,
            int minPwd, bool letterDigit, bool selfUpgrade,
            bool canShare, bool canReceiveShare, int? maxShares,
            bool shareView, bool shareEdit, bool shareDelete, bool shareExec, bool shareDs)
        {
            var plan = await db.Plans.FirstOrDefaultAsync(p => p.Code == code);
            if (plan is null)
            {
                plan = new Plan { Code = code };
                db.Plans.Add(plan);
            }

            plan.NameFa = fa;
            plan.NameEn = en;
            plan.MaxTasks = maxTasks;
            plan.MaxDataSources = maxSources;
            plan.MaxProcessSteps = maxSteps;
            plan.CanPlay = play;
            plan.CanSelector = selector;
            plan.CanRecord = record;
            plan.CanSmart = smart;
            plan.IsActive = true;
            plan.SortOrder = sort;
            plan.MinPasswordLength = minPwd;
            plan.RequireLetterAndDigit = letterDigit;
            plan.AllowSelfUpgrade = selfUpgrade;
            plan.CanShare = canShare;
            plan.CanReceiveShare = canReceiveShare;
            plan.MaxSharesPerTask = maxShares;
            plan.ShareAllowView = shareView;
            plan.ShareAllowEdit = shareEdit;
            plan.ShareAllowDelete = shareDelete;
            plan.ShareAllowExecute = shareExec;
            plan.ShareAllowChangeDataSource = shareDs;
        }

        // Local/guest: no share. Free can share (actor); Pro+ can receive (admin-tunable).
        await UpsertPlan(nameof(PlanCode.Local), "محلی / تست", "Local / Test", 1, 1, 30, false, false, false, false, 1, 3, false, false,
            false, false, null, false, false, false, false, false);
        await UpsertPlan(nameof(PlanCode.Free), "رایگان", "Free", 3, 3, 80, true, true, false, false, 2, 3, false, false,
            true, false, 3, true, true, false, true, false);
        await UpsertPlan(nameof(PlanCode.Pro), "حرفه‌ای", "Pro", null, null, null, true, true, true, false, 3, 8, true, true,
            true, true, null, true, true, true, true, true);
        await UpsertPlan(nameof(PlanCode.Gold), "طلایی", "Gold", null, null, null, true, true, true, true, 4, 8, true, true,
            true, true, null, true, true, true, true, true);
        await db.SaveChangesAsync();

        var pro = await db.Plans.FirstAsync(p => p.Code == nameof(PlanCode.Pro));
        if (!await db.PlanPrices.AnyAsync(p => p.PlanId == pro.Id))
        {
            db.PlanPrices.Add(new PlanPrice
            {
                PlanId = pro.Id,
                Amount = 990000,
                Currency = "IRR",
                Interval = "monthly",
                IsActive = true,
                Notes = "Default Pro monthly price (admin-managed; no payment gateway yet)"
            });
            await db.SaveChangesAsync();
        }
    }

    private static async Task EnsureSystemSettingsAsync(AppDbContext db)
    {
        async Task Upsert(string key, string value, string group, string fa, string en, string? hintFa = null, string? hintEn = null)
        {
            var row = await db.SystemSettings.FirstOrDefaultAsync(s => s.Key == key);
            if (row is null)
            {
                db.SystemSettings.Add(new SystemSetting
                {
                    Key = key,
                    Value = value,
                    Group = group,
                    LabelFa = fa,
                    LabelEn = en,
                    HintFa = hintFa,
                    HintEn = hintEn
                });
            }
            else
            {
                row.Group = group;
                row.LabelFa = fa;
                row.LabelEn = en;
                row.HintFa = hintFa;
                row.HintEn = hintEn;
                // keep Value (admin-edited)
            }
        }

        await Upsert(
            SystemSettingKeys.DefaultRegisterPlan,
            nameof(PlanCode.Free),
            "Auth",
            "پلن پیش‌فرض ثبت‌نام",
            "Default registration plan",
            "کد پلن فعال برای کاربران جدید (مثلاً Free)",
            "Active plan code assigned to new registrations (e.g. Free)");

        await Upsert(
            SystemSettingKeys.UpdateServerUrl,
            UpdateCheckService.DefaultUpdateUrl,
            "Updates",
            "آدرس بررسی آپدیت",
            "Update check URL",
            "پیش‌فرض: https://morobot.ir/checkupdate — می‌توانید مسیر سفارشی اضافه کنید.",
            "Default: https://morobot.ir/checkupdate — you may append a custom path.");

        await Upsert(SystemSettingKeys.UpdateLastCheckUtc, "", "Updates", "آخرین بررسی آپدیت", "Last update check", null, null);
        await Upsert(SystemSettingKeys.UpdateAvailableVersion, "", "Updates", "نسخه موجود", "Available version", null, null);
        await Upsert(SystemSettingKeys.UpdateAvailableNotes, "", "Updates", "یادداشت نسخه", "Release notes", null, null);
        await Upsert(SystemSettingKeys.UpdateAvailableUrl, "", "Updates", "لینک دانلود", "Download URL", null, null);

        await Upsert(SystemSettingKeys.BrandAppName, "Morobot", "Branding", "نام اپلیکیشن", "Application name", "فقط با لایسنس معتبر.", "Licensed installs only.");
        await Upsert(SystemSettingKeys.BrandTitle, "Morobot", "Branding", "عنوان برند", "Brand title", null, null);
        await Upsert(SystemSettingKeys.BrandOrganization, "", "Branding", "نام سازمان", "Organization name", null, null);
        await Upsert(SystemSettingKeys.BrandLogoPath, "", "Branding", "مسیر لوگو", "Logo path", "/uploads/branding/logo.png", "/uploads/branding/logo.png");
        await Upsert(SystemSettingKeys.BrandFaviconPath, "", "Branding", "مسیر فاوآیکون", "Favicon path", "/uploads/branding/favicon.png", "/uploads/branding/favicon.png");
        await Upsert(SystemSettingKeys.BrandColorPrimary, BrandPaletteDefaults.Primary, "Branding", "رنگ اصلی", "Primary color", null, null);
        await Upsert(SystemSettingKeys.BrandColorPrimaryDark, BrandPaletteDefaults.PrimaryDark, "Branding", "رنگ اصلی تیره", "Primary dark", null, null);
        await Upsert(SystemSettingKeys.BrandColorPrimaryLight, BrandPaletteDefaults.PrimaryLight, "Branding", "رنگ اصلی روشن", "Primary light", null, null);
        await Upsert(SystemSettingKeys.BrandColorAccent, BrandPaletteDefaults.Accent, "Branding", "رنگ تأکید", "Accent color", null, null);
        await Upsert(SystemSettingKeys.BrandColorSoft, BrandPaletteDefaults.Soft, "Branding", "پس‌زمینه ملایم", "Soft background", null, null);
        await Upsert(SystemSettingKeys.BrandColorSoft2, BrandPaletteDefaults.Soft2, "Branding", "پس‌زمینه ملایم ۲", "Soft background 2", null, null);
        await Upsert(SystemSettingKeys.BrandColorInk, BrandPaletteDefaults.Ink, "Branding", "رنگ متن", "Ink color", null, null);
        await Upsert(SystemSettingKeys.BrandColorBorderSubtle, BrandPaletteDefaults.BorderSubtle, "Branding", "حاشیه ملایم", "Subtle border", null, null);
        await Upsert(SystemSettingKeys.BrandReferralQrVisible, "true", "Branding", "ویجت QR معرفی", "Referral QR widget", "پیش‌فرض: نمایش", "Default: visible");

        await Upsert(SystemSettingKeys.LicensedDatabaseConnection, "", "Deployment", "Connection string (license)", "Connection string (license)", "توسط لایسنس امضاشده تنظیم می‌شود.", "Set by signed license.");
        await Upsert(SystemSettingKeys.PendingConnectionRestart, "", "Deployment", "نیاز به راه‌اندازی مجدد", "Restart required", null, null);

        await db.SaveChangesAsync();
    }

    private static async Task EnsureUsersAsync(AppDbContext db)
    {
        var hasher = new PasswordHasher<AppUser>();
        var localPlan = await db.Plans.FirstAsync(p => p.Code == nameof(PlanCode.Local));
        var freePlan = await db.Plans.FirstAsync(p => p.Code == nameof(PlanCode.Free));
        var proPlan = await db.Plans.FirstAsync(p => p.Code == nameof(PlanCode.Pro));

        async Task EnsureUser(string userName, string password, string first, string last,
            UserRole role, Plan plan)
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.UserName == userName);
            if (user is null)
            {
                user = new AppUser
                {
                    UserName = userName,
                    FirstName = first,
                    LastName = last,
                    IsActive = true,
                    CreatedAtUtc = DateTime.UtcNow
                };
                user.PasswordHash = hasher.HashPassword(user, password);
                db.Users.Add(user);
            }

            user.Role = role;
            user.PlanId = plan.Id;
            user.IsActive = true;
            if (string.IsNullOrEmpty(user.PasswordHash) || user.PasswordHash.Length < 10)
                user.PasswordHash = hasher.HashPassword(user, password);
        }

        await EnsureUser("guest", "Guest123!", "کاربر", "مهمان", UserRole.User, localPlan);
        await EnsureUser("admin", "Admin123!", "مدیر", "سیستم", UserRole.Admin, proPlan);
        await EnsureUser("free", "Free123!", "کاربر", "رایگان", UserRole.User, freePlan);
        await EnsureUser("pro", "Pro123!", "کاربر", "حرفه‌ای", UserRole.User, proPlan);
        await db.SaveChangesAsync();

        // Owner shares already have full ACL on create; no CanModify backfill after Canvas-first.
    }
}
