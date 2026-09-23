# وضعیت پروژه — برای باز کردن این پوشه

مسیر ورک‌اسپیس فعلی؛ ریموت: https://github.com/lliehos/NewDynamicAutomator

برنچ فعال توسعه: `feature/tiers-admin-stage1`

## حالت فعلی

- **پلن‌ها (ادمین‌قابل‌ویرایش):** `MaxTasks` / `MaxDataSources` / `MaxProcessSteps` (خالی = ∞)
  - Local ۱/۱/۳۰ — Free ۳/۳/۸۰ — Pro/Gold نامحدود (پیش‌فرض seed)
- **منابع مستقل:** جدول `DataSources` + لینک `ProcessDataSources`؛ detach ≠ حذف؛ حذف فرآیند کتابخانه را پاک نمی‌کند
- **انتقال قدیمی (Admin → Migrate):** فقط فرآیندهای مالک کاربر + گراف (گروه/مرحله/شرط)؛ بدون منبع
- **پروفایل اجباری:** نام/فامیل/ایمیل/موبایل قبل از استفاده پنل؛ ناو نمایش display name
- **کاتالوگ زنده:** نوتیف فقط به مالک/share
- **افزونه‌ها:** فقط `extension-{recorder|player|selector|smart-recorder}` (mono `extension/` حذف شد)
- Seed: `guest`/`free`/`pro`/`admin` — رمزها در [plans-and-tiers.md](plans-and-tiers.md)

پرتال: `https://localhost:7201`

```bash
dotnet run --project src/Morobot.Web --launch-profile https
```

## مستندات

- دامنه: [domain.md](domain.md)
- پلن‌ها: [plans-and-tiers.md](plans-and-tiers.md)
- معماری: [architecture.md](architecture.md)
- آرشیو V2: [legacy-windows-v2.md](legacy-windows-v2.md)
- ویرایشگر: [visual-editor.md](visual-editor.md)
- رکورد/پخش: [record-play.md](record-play.md)

## خارج از اسکوپ این برنچ

- Learn / Smart / قابلیت‌های سطح طلایی (AI)
- درگاه پرداخت
