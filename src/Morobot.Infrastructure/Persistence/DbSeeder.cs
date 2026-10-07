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
        // A starter price list so the commerce pages have something to show on a fresh install
        // instead of a blank wizard. Seeded only when absent, like the plans: an operator's own
        // pricing must never be overwritten by a later deploy.
        await EnsureCommerceDefaultsAsync(db);
        await EnsureUsersAsync(db);
    }

    /// <summary>
    /// Seed the software-package options and the license price list, once.
    /// </summary>
    /// <remarks>
    /// The values are a sensible starting point, not a recommendation: they mirror the feature set
    /// the product already knows how to gate, so the purchase wizard works end to end on day one and
    /// the operator edits numbers rather than inventing a price list from nothing.
    /// </remarks>
    private static async Task EnsureCommerceDefaultsAsync(AppDbContext db)
    {
        if (!await db.SoftwarePackageOptions.AnyAsync())
        {
            db.SoftwarePackageOptions.AddRange(
                new SoftwarePackageOption
                {
                    Key = "base",
                    Title = "بستهٔ پایه نرم‌افزار",
                    Description = "نسخهٔ ویندوزی (سروری یا اجرای محلی) با یک کاربر.",
                    Kind = PackageOptionKind.Limit,
                    IncludedUnits = 1,
                    UnitAmount = 2_000_000m,
                    MaxUnits = 100,
                    UnitLabel = "کاربر",
                    IsDefault = true,
                    SortOrder = 0
                },
                new SoftwarePackageOption
                {
                    Key = "local_run",
                    Title = "اجرای محلی",
                    Description = "اجرای فرآیندها روی سیستم کاربر.",
                    Kind = PackageOptionKind.Feature,
                    Amount = 15_000_000m,
                    SortOrder = 1
                },
                new SoftwarePackageOption
                {
                    Key = "bilingual",
                    Title = "دو زبانه",
                    Description = "رابط فارسی و انگلیسی.",
                    Kind = PackageOptionKind.Feature,
                    Amount = 5_000_000m,
                    SortOrder = 2
                },
                new SoftwarePackageOption
                {
                    Key = "front_package",
                    Title = "بستهٔ سایت عمومی",
                    Description = "سایت عمومی با صفحهٔ قیمت.",
                    Kind = PackageOptionKind.Feature,
                    Amount = 20_000_000m,
                    SortOrder = 3
                },
                new SoftwarePackageOption
                {
                    Key = "commerce",
                    Title = "فروش (پلن، بسته، لایسنس)",
                    Description = "امکان فروش در همین نصب.",
                    Kind = PackageOptionKind.Feature,
                    Amount = 30_000_000m,
                    SortOrder = 4
                });
        }

        if (!await db.LicensePricings.AnyAsync())
        {
            db.LicensePricings.Add(new LicensePricing
            {
                BaseAmount = 10_000_000m,
                PerUserAmount = 1_500_000m,
                IncludedUsers = 1,
                MaxUsers = 100,
                YearlyTermMultiplier = 10m,
                PerpetualMultiplier = 30m,
                Currency = "IRR"
            });
        }

        await db.SaveChangesAsync();
    }

    private static async Task EnsurePlansAsync(AppDbContext db)
    {
        async Task UpsertPlan(
            string code, string fa, string en, int? maxTasks, int? maxSources, int? maxSteps,
            bool play, bool selector, bool record, bool smart, int sort,
            int minPwd, bool letterDigit, bool selfUpgrade,
            bool canShare, bool canReceiveShare, int? maxShares,
            bool shareView, bool shareEdit, bool shareDelete, bool shareExec, bool shareDs,
            decimal? monthly, decimal? yearly)
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

            // Seed the shipped price ONLY when the plan has no price at all. A price is commercial
            // data the admin owns, so an existing value is never overwritten; but leaving every
            // existing plan at NULL would make the new pricing fields look broken on an upgrade,
            // since the admin has no way to know a value was ever intended.
            if (plan.MonthlyPrice is null && plan.YearlyPrice is null && (monthly is not null || yearly is not null))
            {
                plan.MonthlyPrice = monthly;
                plan.YearlyPrice = yearly;
                plan.PriceCurrency = "IRR";
            }
        }

        // Local/guest: no share. Free can share (actor); Pro+ can receive (admin-tunable).
        // Local and Free have no price: one is a sign-in placeholder and the other is free.
        await UpsertPlan(nameof(PlanCode.Local), "محلی / تست", "Local / Test", 1, 1, 30, false, false, false, false, 1, 3, false, false,
            false, false, null, false, false, false, false, false, null, null);
        await UpsertPlan(nameof(PlanCode.Free), "رایگان", "Free", 3, 3, 80, true, true, false, false, 2, 3, false, false,
            true, false, 3, true, true, false, true, false, null, null);
        await UpsertPlan(nameof(PlanCode.Pro), "حرفه‌ای", "Pro", null, null, null, true, true, true, false, 3, 8, true, true,
            true, true, null, true, true, true, true, true, 990000m, 9900000m);
        await UpsertPlan(nameof(PlanCode.Gold), "طلایی", "Gold", null, null, null, true, true, true, true, 4, 8, true, true,
            true, true, null, true, true, true, true, true, 1990000m, 19900000m);
        await db.SaveChangesAsync();
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

        // The two independent provider switches. Seeded so a fresh install has them, and so the
        // back-compat path (which looks for their presence) takes the modern branch straight away.
        //
        // The legacy single-choice "AuthMode" row is deliberately NOT seeded: it is superseded by
        // these two, and seeding it meant every fresh install carried a third, contradictory way
        // to express the same choice.
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
            "هاست اکتیو دایرکتوری",
            "Active Directory host",
            "نام یا IP سرور دامین‌کنترلر؛ بدون http و بدون پورت.",
            "Host name or IP of the domain controller; no scheme, no port.");

        await Upsert(
            SystemSettingKeys.LdapPort,
            "",
            "Auth",
            "پورت",
            "Port",
            "خالی = پورت پیش‌فرض بر اساس حالت امن (389 بدون TLS، 636 با TLS).",
            "Blank = the conventional port for the transport (389 plain, 636 with TLS).");

        await Upsert(
            SystemSettingKeys.LdapDomain,
            "",
            "Auth",
            "دامنه",
            "Domain",
            "دامنهٔ اکتیو دایرکتوری، مثلاً corp یا corp.local. خالی بگذارید تا از هاست استخراج شود.",
            "The Active Directory domain, e.g. corp or corp.local. Leave blank to take it from the host.");

        await Upsert(
            SystemSettingKeys.LdapNameFormat,
            nameof(LdapNameFormat.DomainBackslash),
            "Auth",
            "قالب نام ورود",
            "Sign-in name format",
            "شکلی که نام کاربر به اکتیو دایرکتوری داده می‌شود: «دامنه\\کاربر» برای دامین داخلی، «کاربر@دامنه» برای مایکروسافت ۳۶۵، یا «نام کاربری» تا بدون هیچ پیشوندی فرستاده شود.",
            "How the user name is given to Active Directory: domain\\user for an on-premises domain, user@domain for Microsoft 365, or plain user name to send it with no prefix.");

        await Upsert(
            SystemSettingKeys.LdapUseTls,
            "false",
            "Auth",
            "اتصال امن (TLS)",
            "Secure connection (TLS)",
            "با روشن بودن، اتصال LDAPS برقرار می‌شود و گواهی سرور بررسی می‌گردد. خاموش بودن، رمز را روی شبکه به‌صورت متن ساده می‌فرستد.",
            "When on, the connection uses LDAPS and the server certificate is validated. When off, the password crosses the network in the clear.");

        // The deployment-wide password floor. It is the fallback for a plan that states no rules of
        // its own, and the only policy an install with no plan levels has. Seeded at the value a
        // typical Free signup already used, so turning it on changes nothing for existing installs.
        await Upsert(
            SystemSettingKeys.PasswordMinLength,
            PasswordPolicy.FallbackMinLength.ToString(),
            "Auth",
            "حداقل طول رمز عبور",
            "Minimum password length",
            "کمترین تعداد نویسه برای رمز عبور. اگر پلنی قاعدهٔ خودش را داشته باشد، همان اعمال می‌شود و این مقدار نادیده گرفته می‌شود.",
            "Fewest characters a password may have. A plan that states its own rule overrides this value.");

        await Upsert(
            SystemSettingKeys.PasswordRequireLetterAndDigit,
            "false",
            "Auth",
            "الزام حرف و رقم در رمز",
            "Require a letter and a digit",
            "با روشن بودن، رمز عبور باید دست‌کم یک حرف و یک رقم داشته باشد. پلنی که قاعدهٔ خودش را دارد، بر این تنظیم مقدم است.",
            "When on, a password must contain at least one letter and one digit. A plan with its own rule takes precedence.");

        // The language a first-time visitor sees. The per-visitor cookie still wins once someone
        // chooses, so this only decides the starting point.
        await Upsert(
            SystemSettingKeys.DefaultLanguage,
            "fa",
            "Auth",
            "زبان پیش‌فرض سامانه",
            "Default system language",
            "زبانی که بازدیدکنندهٔ تازه با آن روبه‌رو می‌شود. هر کاربری که خودش زبان را تغییر دهد، انتخاب خودش را می‌بیند.",
            "The language a first-time visitor is shown. Anyone who changes the language themselves keeps their own choice.");

        // The branding stamp must have a row to exist at all: BrandingService writes it and throws
        // for an undeclared key, and the cache path reads it on every request. Seeded empty, which
        // means "no stamp yet" — the first render fills it in.
        await Upsert(
            SystemSettingKeys.BrandStamp,
            "",
            "Branding",
            "اثر انگشت برندینگ",
            "Branding stamp",
            "به‌صورت خودکار نوشته می‌شود؛ دست نزنید. برای تشخیص تغییر برندینگ و تازه‌سازی کش مرورگر است.",
            "Written automatically; do not edit. Used to detect a branding change and refresh the browser's cached copy.");

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

        // Legacy single-value identity rows. Not on the branding page any more — it has one box per
        // language — but kept as the fallback for an install or licence whose only value is this
        // one. Labelled "legacy" so the row is not mistaken for something still being edited.
        await Upsert(SystemSettingKeys.BrandAppName, "Morobot", "Branding", "نام اپلیکیشن (قدیمی)", "Application name (legacy)", "دیگر در صفحهٔ برندینگ ویرایش نمی‌شود؛ فقط به‌عنوان مقدار پشتیبان برای نصب‌های قدیمی می‌ماند.", "No longer edited on Admin → Branding; kept only as the fallback for an older install.");
        await Upsert(SystemSettingKeys.BrandTitle, "Morobot", "Branding", "عنوان برند (قدیمی)", "Brand title (legacy)", null, null);
        await Upsert(SystemSettingKeys.BrandOrganization, "", "Branding", "نام سازمان (قدیمی)", "Organization name (legacy)", null, null);
        // One value per language. A blank language falls back to the OTHER language, then to the
        // legacy row above, so a deployment that fills only one side still shows a name in both.
        await Upsert(SystemSettingKeys.BrandAppNameFa, "", "Branding", "نام اپلیکیشن (فارسی)", "Application name (Persian)", "خالی = استفاده از مقدار انگلیسی", "Blank = use the English value");
        await Upsert(SystemSettingKeys.BrandAppNameEn, "", "Branding", "نام اپلیکیشن (انگلیسی)", "Application name (English)", "خالی = استفاده از مقدار فارسی", "Blank = use the Persian value");
        // The per-language brand TITLE rows are gone: the title now follows the application name, so
        // the pair was a second way to say the same thing that nothing displayed on its own. Rows left
        // behind by an older install are simply ignored — the row is only ever read through the key
        // constants, and those no longer exist.
        await Upsert(SystemSettingKeys.BrandOrganizationFa, "", "Branding", "نام سازمان (فارسی)", "Organization (Persian)", "خالی = استفاده از مقدار انگلیسی", "Blank = use the English value");
        await Upsert(SystemSettingKeys.BrandOrganizationEn, "", "Branding", "نام سازمان (انگلیسی)", "Organization (English)", "خالی = استفاده از مقدار فارسی", "Blank = use the Persian value");
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
        // Seeded as OFF on purpose: the licence says whether the deployment OWNS the front-end
        // package, this switch says whether its owner wants the public site shown. Defaulting it on
        // would publish a public front page the moment a licence granted the package, before anyone
        // had decided to.
        await Upsert(SystemSettingKeys.FrontShowSite, "false", "Branding", "نمایش سایت فرانت", "Show front site", "نیازمند لایسنس بستهٔ فرانت", "Requires the front-package licence");

        // The six node colours used to be seeded here one by one. They are now all covered by the
        // DiagramColors catalogue loop further down, and seeding them twice in the same run was a
        // real bug: Upsert only looks in the database, so the second call did not see the first
        // call's still-unsaved row and queued a second INSERT for the same unique key — which is
        // exactly the DiagramStepStroke duplicate-key crash. One source of truth: the catalogue.

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
            "پیش‌فرض چشم‌پوشی از خطا (نود شروع)",
            "Ignore errors by default (start node)",
            "وضعیت پیش‌فرض کلید «چشم‌پوشی از خطای اجرا» روی نود شروع، در فرآیندهای جدید. با روشن بودن، اجرا پس از خطای یک اقدام متوقف نمی‌شود.",
            "Starting state of the start node's \"ignore run errors\" switch in a new process. When on, a failed action does not stop the run.");

        await Upsert(
            SystemSettingKeys.DiagramNodeIgnoreError,
            "true",
            "Diagram",
            "پیش‌فرض چشم‌پوشی از خطا (نودهای داخلی)",
            "Ignore errors by default (inner nodes)",
            "وضعیت پیش‌فرض کلید «چشم‌پوشی از خطای این اقدام» روی نودهای داخلی. از نود شروع جدا است: می‌توان اجرا را ادامه داد ولی خطای هر اقدام جداگانه ثبت شود.",
            "Starting state of an inner node's \"ignore this step's error\" switch. Separate from the start node: the run may continue while each action's failure is still reported.");

        // The per-colour "apply" switches are gone. They let an administrator compare a colour
        // against the built-in default without retyping it, but they also made every colour mean
        // two settings and left the editor to decide which won. The branding page now has a
        // reset-to-default action per colour; any row an older install still has is deleted by the
        // cleanup and filtered out of the page (see SystemSettingKeys.RetiredDiagramColorSwitches).

        // Every diagram colour is seeded from the one catalogue, so a colour added there arrives
        // with its shipped default and a value the reset button can restore.
        foreach (var color in SystemSettingKeys.DiagramColors)
        {
            await Upsert(
                color.Key,
                color.DefaultValue,
                color.Group,
                color.LabelFa,
                color.LabelEn,
                null,
                null);
        }

        await Upsert(SystemSettingKeys.LicensedDatabaseConnection, "", "Deployment", "Connection string (license)", "Connection string (license)", "توسط لایسنس امضاشده تنظیم می‌شود.", "Set by signed license.");        await Upsert(SystemSettingKeys.PendingConnectionRestart, "", "Deployment", "نیاز به راه‌اندازی مجدد", "Restart required", null, null);

        await db.SaveChangesAsync();
    }

    private static async Task EnsureUsersAsync(AppDbContext db)
    {
        var hasher = new PasswordHasher<AppUser>();
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

        // The administrator is the ONLY account a fresh install gets.
        //
        // The app has public self-registration, so every additional seeded account competes with it:
        // the earlier set (guest/free/pro/pm) either gave away paid features for free or handed out a
        // shared password that nobody was going to change. Seeding the administrator alone keeps the
        // first-run decision in the admin's hands — sign in, then create whoever the deployment
        // actually needs.
        await EnsureUser("admin", "Admin123!", "مدیر", "سیستم", UserRole.Admin, proPlan);

        // Demo accounts, only when they are asked for.
        //
        // They are still needed: the one-click dev login resolves each name to a fixed password, the
        // handover and manual-test checklists walk through the Free/Pro/Local plans, and the
        // ProcessManager role has no other way to be tried. Gating them behind a setting means a
        // production install never carries a known-password account, while a dev machine can still
        // have them by setting Morobot:SeedDemoUsers=true.
        if (SeedDemoUsers())
        {
            var localPlan = await db.Plans.FirstAsync(p => p.Code == nameof(PlanCode.Local));
            var freePlan = await db.Plans.FirstAsync(p => p.Code == nameof(PlanCode.Free));
            await EnsureUser("guest", "Guest123!", "کاربر", "مهمان", UserRole.User, localPlan);
            await EnsureUser("free", "Free123!", "کاربر", "رایگان", UserRole.User, freePlan);
            await EnsureUser("pro", "Pro123!", "کاربر", "حرفه‌ای", UserRole.User, proPlan);
            // A demo process manager. The role exists to own the shared templates without being a full
            // administrator, and without an account that carries it there is no way to try that path.
            // Given the Pro plan because template work is part of the Pro feature set.
            await EnsureUser("pm", "Pm123!", "کاربر", "مدیر فرآیند", UserRole.ProcessManager, proPlan);
        }

        await db.SaveChangesAsync();

        // Owner shares already have full ACL on create; no CanModify backfill after Canvas-first.
    }

    /// <summary>
    /// Whether to also create the demo accounts (guest/free/pro/pm).
    /// </summary>
    /// <remarks>
    /// Opt-in, and only in Development by default. The flag alone is not enough to enable them in
    /// Production: these accounts share well-known passwords, so a misconfigured production
    /// environment variable must not be able to reintroduce them silently. An operator who really
    /// wants them in production can still set <c>Morobot:SeedDemoUsersForce=true</c>, which makes the
    /// intent explicit rather than accidental.
    /// </remarks>
    private static bool SeedDemoUsers()
    {
        static string? Read(string key)
            => Environment.GetEnvironmentVariable(key)
               ?? Environment.GetEnvironmentVariable(key.Replace(":", "__"));

        var optIn = string.Equals(Read("Morobot:SeedDemoUsers"), "true", StringComparison.OrdinalIgnoreCase);
        if (!optIn) return false;

        var isDevelopment = string.Equals(
            Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"),
            "Development", StringComparison.OrdinalIgnoreCase);
        var forced = string.Equals(Read("Morobot:SeedDemoUsersForce"), "true", StringComparison.OrdinalIgnoreCase);

        return isDevelopment || forced;
    }
}
