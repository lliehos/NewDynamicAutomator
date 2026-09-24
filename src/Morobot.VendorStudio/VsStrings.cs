namespace Morobot.VendorStudio;

internal static class VsStrings
{
    public const string WindowTitle = "استودیو فروشنده مروبات";
    public const string HeaderTitle = "استودیو فروشنده (Vendor Studio)";
    public const string HeaderSubtitle = "امضای لایسنس Enterprise و ساخت بسته سرور مشتری — فقط روی ماشین vendor";

    public const string TabLicense = "لایسنس";
    public const string TabPackage = "بسته نصب";

    public const string ErrInvalidRequest = "فایل درخواست فعال‌سازی معتبر نیست.";
    public const string ErrValidUntil = "تاریخ پایان اعتبار را انتخاب کنید.";
    public const string ErrRequestPath = "مسیر فایل درخواست فعال‌سازی را انتخاب کنید.";
    public const string ErrPrivateKey = "مسیر کلید خصوصی (.pem) را انتخاب کنید.";
    public const string ErrProjectPath = "مسیر Morobot.Web.csproj را مشخص کنید.";
    public const string ErrOutputPath = "پوشه خروجی publish را مشخص کنید.";
    public const string ErrPublish = "dotnet publish با خطا تمام شد (کد {0}).";

    public const string MsgSignFailed = "خطا در امضای لایسنس";
    public const string MsgPackageFailed = "خطا در ساخت بسته";
    public const string StatusSigned = "لایسنس امضا شد: {0}";
    public const string StatusSaved = "ذخیره شد: {0}";
    public const string StatusPublishing = "در حال publish…";
    public const string StatusPackageReady = "بسته آماده: {0}";

    public const string Browse = "انتخاب…";
    public const string SignLicense = "امضای لایسنس";
    public const string SaveLicense = "ذخیره .morobot";
    public const string BuildPackage = "ساخت بسته (zip)";

    public const string Required = "اجباری";
    public const string Optional = "اختیاری";
}
