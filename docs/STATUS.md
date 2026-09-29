# وضعیت پروژه — برای باز کردن این پوشه

مسیر ورک‌اسپیس فعلی؛ ریموت: https://github.com/lliehos/NewDynamicAutomator

برنچ فعال توسعه: `Record-EngineTuning` (از `Play-Engin-And-Extensio-Tuning`)

## حالت فعلی

- **پلن‌ها (ادمین‌قابل‌ویرایش):** `MaxTasks` / `MaxDataSources` / `MaxProcessSteps` (خالی = ∞)
  - Local ۱/۱/۳۰ — Free ۳/۳/۸۰ — Pro/Gold نامحدود (پیش‌فرض seed)
- **منابع مستقل:** جدول `DataSources` + لینک `ProcessDataSources`؛ detach ≠ حذف؛ حذف فرآیند کتابخانه را پاک نمی‌کند
- **انتقال قدیمی (Admin → Migrate):** فقط فرآیندهای مالک کاربر + گراف (گروه/مرحله/شرط)؛ بدون منبع
- **پروفایل اجباری:** نام/فامیل/ایمیل/موبایل قبل از استفاده پنل؛ ناو نمایش display name
- **کاتالوگ زنده:** نوتیف به مالک/share؛ ادمین با `JoinAdminCatalog` همهٔ `taskChanged` / `sourceChanged` / `playState` را می‌بیند (نوع تغییر + چشمک اجرا)
- **ادمین منابع:** مشاهده دیتا + دانلود اکسل از `/Admin/Sources`
- **افزونه‌ها:** `extension-global` + `extension-smart-recorder`؛ مسیر: `%LocalAppData%\morobot.soras.ir\{AppInstanceKey}\`
- **افزونهٔ گلوبال (۲.۳.۹):** رکوردر دو دکمهٔ ذخیره دارد — فلاپی = «ذخیره و ادامه»، چرخ‌دنده = «ذخیره و پایان ضبط»
- **تداخل چند-سروری (اصلاح‌شده):** سرور در خود جلسه قفل می‌شود (`smartPortalBase` / `recordPortalBase`).
  قبلاً `portalBase` یک کلید سراسری بود و لوکال و سرور مسیر هم را بازنویسی می‌کردند →
  درخواست بی‌صدا به سرور اشتباه می‌رفت («جلسه پیدا نشد» / ۴۰۱ بی‌دلیل).
  `lib/session-scope.js` در هر دو افزونه اضافه شد + `tokenPortalBase` تا توکن لوکال به سرور نرود.
- **رکوردر هوشمند (۱.۰.۷):** ذخیره/کپی در فرآیند + Paste در ادیتور (`DAGRAPH1:`).
  ⚠️ موتور یادگیری (LM) هنوز وصل نیست — گراف با استنتاج محافظه‌کارانه ساخته می‌شود.
- **صفحهٔ نصب افزونه:** در Production بستهٔ zip، در Development (روی همان ماشین) مسیر پوشه.
  مسیر سمت سرور دیگر نمایش داده نمی‌شود، چون روی PC کاربر وجود ندارد.
- Seed: `guest`/`free`/`pro`/`admin` — رمزها در [plans-and-tiers.md](plans-and-tiers.md)

پرتال: `https://localhost:7201`

```bash
dotnet run --project src/Morobot.Web --launch-profile https
```

## مستندات

- **راه‌اندازی / استقرار:** [setup-guide.md](setup-guide.md)
- **عملیات داخلی (لایسنس / kit):** [vendor-ops-guide.md](vendor-ops-guide.md)
- **بروشور فروش (HTML→PDF):** [marketing/morobot-brochure.html](marketing/morobot-brochure.html)
- دامنه: [domain.md](domain.md)
- پلن‌ها: [plans-and-tiers.md](plans-and-tiers.md)
- معماری: [architecture.md](architecture.md)
- آرشیو V2: [legacy-windows-v2.md](legacy-windows-v2.md)
- ویرایشگر: [visual-editor.md](visual-editor.md)
- رکورد/پخش: [record-play.md](record-play.md)

## خارج از اسکوپ این برنچ

- Learn / Smart / قابلیت‌های سطح طلایی (AI)
- درگاه پرداخت
