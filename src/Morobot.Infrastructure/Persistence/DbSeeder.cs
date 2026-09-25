using Morobot.Contracts.Auth;
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
            SystemSettingKeys.AuthMode,
            nameof(AuthMode.Local),
            "Auth",
            "روش احراز هویت",
            "Authentication method",
            "Local = کاربران همین سامانه · Ldap = پوشهٔ سازمانی (Active Directory یا OpenLDAP)",
            "Local = users of this system · Ldap = an organisational directory (Active Directory or OpenLDAP)");

        // The two independent provider switches. Seeded so a fresh install has them, and so the
        // back-compat path (which looks for their presence) takes the modern branch straight away.
        await Upsert(
            SystemSettingKeys.AuthLocalEnabled,
            "true",
            "Auth",
            "ورود با کاربران سامانه",
            "Sign-in with system users",
            "کاربران همین سامانه می‌توانند وارد شوند. حداقل یکی از دو حالت ورود باید روشن بماند.",
            "Users of this system can sign in. At least one sign-in method must stay on.");

        await Upsert(
            SystemSettingKeys.AuthLdapEnabled,
            "false",
            "Auth",
            "ورود با پوشهٔ سازمانی (LDAP)",
            "Sign-in with the directory (LDAP)",
            "وقتی روشن شود، فیلدهای تنظیمات LDAP نمایش داده می‌شوند. پیش‌فرض خاموش است.",
            "Turning this on reveals the LDAP settings fields. Off by default.");

        await Upsert(
            SystemSettingKeys.LdapHost,
            "",
            "Auth",
            "هاست پوشه (LDAP)",
            "Directory host (LDAP)",
            "نام یا IP سرور پوشه؛ بدون http و بدون پورت. فقط وقتی روش احراز هویت Ldap است استفاده می‌شود.",
            "Host name or IP of the directory; no scheme, no port. Used only when the method is Ldap.");

        await Upsert(
            SystemSettingKeys.LdapPort,
            "",
            "Auth",
            "پورت پوشه (LDAP)",
            "Directory port (LDAP)",
            "خالی = پورت پیش‌فرض بر اساس TLS (389 یا 636).",
            "Blank = the conventional port for the transport (389 or 636).");

        await Upsert(
            SystemSettingKeys.LdapBaseDn,
            "",
            "Auth",
            "Base DN",
            "Base DN",
            "مثال: DC=corp,DC=local — نقطهٔ شروع جست‌وجو در پوشه.",
            "For example DC=corp,DC=local — where searches in the directory start.");

        await Upsert(
            SystemSettingKeys.LdapBindDn,
            "",
            "Auth",
            "Bind DN",
            "Bind DN",
            "حساب سرویس برای اتصال به پوشه (در صورت عدم اجازهٔ اتصال ناشناس).",
            "Service account used to reach the directory when anonymous binding is not allowed.");

        await Upsert(
            SystemSettingKeys.LdapBindPassword,
            "",
            "Auth",
            "رمز Bind",
            "Bind password",
            "رمز حساب سرویس. برای امنیت به‌صورت پوشیده نمایش داده می‌شود؛ خالی گذاشتن یعنی بدون تغییر.",
            "Service-account password. Shown masked for safety; leaving it blank keeps the stored value.");

        await Upsert(
            SystemSettingKeys.LdapUserTemplate,
            "{0}",
            "Auth",
            "قالب نام کاربری",
            "User-name template",
            "چگونه نام کاربری به نام ورود تبدیل شود. مثال: {0}@corp.local یا CN={0},OU=People,DC=corp,DC=local",
            "How the typed user name becomes a sign-in name. For example {0}@corp.local or CN={0},OU=People,DC=corp,DC=local");

        await Upsert(
            SystemSettingKeys.LdapUseTls,
            "false",
            "Auth",
            "استفاده از TLS",
            "Use TLS",
            "برای LDAPS یا StartTLS فعال کنید. بدون TLS رمز به‌صورت متن ساده روی شبکه می‌رود.",
            "Enable for LDAPS or StartTLS. Without TLS the password crosses the network in the clear.");

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
        // Per-language overrides. A blank value falls back to the shared value above, so these
        // start empty and only take effect once an admin fills them in.
        await Upsert(SystemSettingKeys.BrandAppNameFa, "", "Branding", "نام اپلیکیشن (فارسی)", "Application name (Persian)", "خالی = استفاده از مقدار مشترک", "Blank = use the shared value");
        await Upsert(SystemSettingKeys.BrandAppNameEn, "", "Branding", "نام اپلیکیشن (انگلیسی)", "Application name (English)", "خالی = استفاده از مقدار مشترک", "Blank = use the shared value");
        await Upsert(SystemSettingKeys.BrandTitleFa, "", "Branding", "عنوان برند (فارسی)", "Brand title (Persian)", "خالی = استفاده از مقدار مشترک", "Blank = use the shared value");
        await Upsert(SystemSettingKeys.BrandTitleEn, "", "Branding", "عنوان برند (انگلیسی)", "Brand title (English)", "خالی = استفاده از مقدار مشترک", "Blank = use the shared value");
        await Upsert(SystemSettingKeys.BrandOrganizationFa, "", "Branding", "نام سازمان (فارسی)", "Organization (Persian)", "خالی = استفاده از مقدار مشترک", "Blank = use the shared value");
        await Upsert(SystemSettingKeys.BrandOrganizationEn, "", "Branding", "نام سازمان (انگلیسی)", "Organization (English)", "خالی = استفاده از مقدار مشترک", "Blank = use the shared value");
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

        await Upsert(
            SystemSettingKeys.DiagramStepStroke,
            "#ff9f43",
            "Diagram",
            "رنگ خط اقدام",
            "Action stroke colour",
            "رنگ حاشیهٔ نودهای اقدام در دیاگرام.",
            "Outline colour of action nodes in the diagram.");

        await Upsert(
            SystemSettingKeys.DiagramStepFill,
            "#fff8f0",
            "Diagram",
            "رنگ پس‌زمینه اقدام",
            "Action fill colour",
            "رنگ داخل نودهای اقدام.",
            "Interior colour of action nodes.");

        await Upsert(
            SystemSettingKeys.DiagramConditionStroke,
            "#8b9098",
            "Diagram",
            "رنگ خط شرط",
            "Condition stroke colour",
            "رنگ حاشیهٔ نودهای شرط.",
            "Outline colour of condition nodes.");

        await Upsert(
            SystemSettingKeys.DiagramConditionFill,
            "#eceff2",
            "Diagram",
            "رنگ پس‌زمینه شرط",
            "Condition fill colour",
            "رنگ داخل نودهای شرط.",
            "Interior colour of condition nodes.");

        await Upsert(
            SystemSettingKeys.DiagramGroupStroke,
            "#9b92f8",
            "Diagram",
            "رنگ خط گروه",
            "Group stroke colour",
            "رنگ حاشیهٔ نودهای گروه.",
            "Outline colour of group nodes.");

        await Upsert(
            SystemSettingKeys.DiagramHighlightColor,
            "#ea5455",
            "Diagram",
            "رنگ هایلایت المان",
            "Element highlight colour",
            "رنگی که پلیر هنگام اجرا دور المان صفحه می‌کشد.",
            "Colour the player draws around the page element while running.");

        await Upsert(
            SystemSettingKeys.DiagramSelectorLineWidth,
            "2",
            "Diagram",
            "پهنای خط سلکتور",
            "Selector line width",
            "ضخامت کادر هایلایت پلیر (پیکسل).",
            "Thickness of the player's highlight box, in pixels.");

        await Upsert(
            SystemSettingKeys.DiagramStepDelayMs,
            "0",
            "Diagram",
            "فاصلهٔ پیش‌فرض مراحل",
            "Default step delay",
            "مکث پیش‌فرض بین دو اقدام (میلی‌ثانیه) در فرآیندهای جدید.",
            "Default pause between two actions, in milliseconds, for new processes.");

        await Upsert(
            SystemSettingKeys.DiagramLoopBackLimit,
            "100",
            "Diagram",
            "حداکثر بازگشت حلقه",
            "Max loop-back visits",
            "پیش‌فرض سقف بازگشت حلقه در فرآیندهای جدید (۱ تا ۱۰۰۰).",
            "Default loop-back ceiling for new processes (1 to 1000).");

        await Upsert(
            SystemSettingKeys.DiagramIgnorePlayError,
            "true",
            "Diagram",
            "چشم‌پوشی از خطای اجرا",
            "Ignore run errors",
            "پیش‌فرض جدید: ادامهٔ اجرا وقتی یک اقدام شکست می‌خورد.",
            "New-process default: keep going when an action fails.");

        // Per-colour switches. Default ON so an upgraded install keeps the colours above.
        await Upsert(SystemSettingKeys.DiagramStepStrokeEnabled, "true", "Diagram",
            "اعمال رنگ خط اقدام", "Apply action stroke",
            "خاموش = رنگ پیش‌فرض دیاگرام استفاده شود (مقدار ذخیره‌شده پاک نمی‌شود).",
            "Off = use the built-in diagram default (the stored value is kept).");
        await Upsert(SystemSettingKeys.DiagramStepFillEnabled, "true", "Diagram",
            "اعمال رنگ پس‌زمینه اقدام", "Apply action fill",
            "خاموش = رنگ پیش‌فرض دیاگرام استفاده شود (مقدار ذخیره‌شده پاک نمی‌شود).",
            "Off = use the built-in diagram default (the stored value is kept).");
        await Upsert(SystemSettingKeys.DiagramConditionStrokeEnabled, "true", "Diagram",
            "اعمال رنگ خط شرط", "Apply condition stroke",
            "خاموش = رنگ پیش‌فرض دیاگرام استفاده شود (مقدار ذخیره‌شده پاک نمی‌شود).",
            "Off = use the built-in diagram default (the stored value is kept).");
        await Upsert(SystemSettingKeys.DiagramConditionFillEnabled, "true", "Diagram",
            "اعمال رنگ پس‌زمینه شرط", "Apply condition fill",
            "خاموش = رنگ پیش‌فرض دیاگرام استفاده شود (مقدار ذخیره‌شده پاک نمی‌شود).",
            "Off = use the built-in diagram default (the stored value is kept).");
        await Upsert(SystemSettingKeys.DiagramGroupStrokeEnabled, "true", "Diagram",
            "اعمال رنگ خط گروه", "Apply group stroke",
            "خاموش = رنگ پیش‌فرض دیاگرام استفاده شود (مقدار ذخیره‌شده پاک نمی‌شود).",
            "Off = use the built-in diagram default (the stored value is kept).");
        await Upsert(SystemSettingKeys.DiagramHighlightColorEnabled, "true", "Diagram",
            "اعمال رنگ هایلایت", "Apply highlight colour",
            "خاموش = رنگ پیش‌فرض دیاگرام استفاده شود (مقدار ذخیره‌شده پاک نمی‌شود).",
            "Off = use the built-in diagram default (the stored value is kept).");

        await Upsert(SystemSettingKeys.LicensedDatabaseConnection, "", "Deployment", "Connection string (license)", "Connection string (license)", "توسط لایسنس امضاشده تنظیم می‌شود.", "Set by signed license.");        await Upsert(SystemSettingKeys.PendingConnectionRestart, "", "Deployment", "نیاز به راه‌اندازی مجدد", "Restart required", null, null);

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
