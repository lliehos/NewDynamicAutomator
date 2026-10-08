namespace Webautomator.Player;

/// <summary>
/// All user-facing text in one place, matching the VendorStudio convention.
/// </summary>
/// <remarks>
/// Kept as constants rather than a resx because the app is single-language (Persian) like the
/// panel's default, and the panel's localization is a licence-gated feature — a desktop runner
/// carrying a half-finished translation layer would be worse than a clear, complete one.
/// </remarks>
internal static class DsStrings
{
    public const string AppTitle = "اجراکننده محلی وباتومیتور";
    public const string AppSubtitle = "اجرای فرآیندها روی همین سیستم، بدون وابستگی به سرور";

    // ---- Login ----
    public const string LoginTitle = "ورود به سرور";
    public const string Login = "ورود";
    public const string LoginWithBrowser = "ورود با مرورگر";
    public const string LoggingIn = "منتظر تکمیل ورود در مرورگر…";
    public const string Logout = "خروج";
    public const string LoginFailed = "ورود انجام نشد.";
    public const string ServerFromLicense = "آدرس سرور";
    public const string ErrServerUrl = "آدرس سرور در لایسنس این نصب مشخص نشده است.";
    public const string NoServerAddress = "سرور: مشخص نشده — لایسنس یا بستهٔ نصب آدرس سرور را نداشت.";

    // ---- Process list ----
    public const string Processes = "فرآیندها";
    public const string Refresh = "بازخوانی";
    public const string Refreshing = "در حال دریافت فرآیندها…";
    public const string NoProcesses = "فرآیندی برای این حساب نیست.";
    public const string ColTitle = "عنوان";
    public const string ColGroups = "گروه";
    public const string ColSteps = "مرحله";
    public const string ColSources = "منبع";
    public const string ColLastRun = "آخرین اجرا";
    public const string ColMode = "اجرا";
    public const string ColActions = "عملیات";
    public const string RunOnServer = "روی سرور";
    public const string RunOnServerHint = "روشن: اجرا روی سرور ثبت می‌شود. خاموش: اجرا کامل روی همین سیستم انجام می‌شود.";
    public const string Run = "اجرا";
    public const string Edit = "ویرایش";
    public const string EditHint = "باز کردن این فرآیند در پنل وب";
    public const string Sync = "سینک";
    public const string SyncHint = "نتیجهٔ اجرای محلی را روی سرور بنویس";
    public const string Stop = "توقف";

    // ---- Repeat indices ----
    public const string RepeatTitle = "انتخاب اندیس تکرار";
    public const string RepeatHint = "این فرآیند بیش از یک تکرار دارد. اندیس‌هایی که باید اجرا شوند را انتخاب کنید.";
    public const string RepeatAll = "همه";
    public const string RepeatNone = "هیچ";
    public const string RepeatStart = "شروع اجرا";
    public const string RepeatNeedOne = "حداقل یک اندیس انتخاب کنید.";

    // ---- Run window ----
    public const string RunWindowTitle = "نتیجهٔ اجرا";
    public const string RunReady = "آماده";
    public const string RunStarting = "در حال آماده‌سازی…";
    public const string RunInProgress = "در حال اجرا…";
    public const string RunDone = "اجرا تمام شد";
    public const string RunFailed = "اجرا با خطا تمام شد";
    public const string RunStopped = "اجرا متوقف شد";
    public const string LocalMode = "حالت محلی";
    public const string ServerMode = "حالت سرور";

    // ---- Sync confirm ----
    public const string SyncConfirmTitle = "تأیید سینک";
    public const string SyncConfirmBody =
        "نتیجهٔ اجرای محلی — از جمله تغییراتی که در منابع محلی ایجاد شده — روی سرور نوشته می‌شود. " +
        "نسخهٔ سرور از این پس با نسخهٔ محلی یکی می‌شود؛ اگر روی سرور تغییر کرده باشد، " +
        "ممکن است اطلاعات آن جایگزین یا از دست برود. ادامه می‌دهید؟";
    public const string SyncDone = "سینک انجام شد.";
    public const string SyncFailed = "سینک ناموفق بود.";

    // ---- Local mode ----
    public const string LocalModeHint =
        "روی همین سیستم اجرا می‌شود: فرآیند و منابعش (بجز منابع عمومی) محلی می‌شوند و چیزی روی سرور " +
        "ثبت نمی‌شود. برای برگرداندن نتیجه، بعداً از دکمهٔ «سینک» استفاده کنید.";

    // ---- License gate ----
    public const string LicenseBlocked = "این نسخه اجازهٔ اجرای محلی ندارد";
    public const string LicenseBlockedBody =
        "قابلیت اجرای محلی در لایسنس این نصب فعال نشده است. برای فعال‌سازی با فروشنده تماس بگیرید.";
    public const string LicenseMissing = "لایسنس معتبری برای این سرور یافت نشد.";

    // ---- WebDriver ----
    public const string DriverMissing = "فایرفاکس یا درایورش پیدا نشد";
    public const string DriverMissingBody =
        "برای اجرا به فایرفاکس و geckodriver نیاز است. هر دو باید روی این سیستم نصب باشند.";
    public const string DriverCheck = "بررسی پیش‌نیازها";

    public const string Common = "مشترک";
    public const string Ok = "تأیید";
    public const string Cancel = "انصراف";
    public const string Close = "بستن";
}
