# وضعیت پروژه — برای باز کردن این پوشه

مسیر: `C:\Projects\MorobotV3`  
ریموت: https://github.com/lliehos/NewDynamicAutomator

## حالت فعلی: Local-first + Panel Area + i18n + رمزنگاری محلی

- لاگین **فرضی** (هر یوزر؛ پیشنهاد `test` / `test`) — بدون چک سرور
- فرآیندها / گراف در **مرورگر** با `localStorage` رمزنگاری‌شده (`mrbt1:` / AES-256-GCM)
- خروجی/ورودی فرآیند: فرمت `.mrbt` (همان JSON رمزشده)
- کلید سراسری MVP در `wwwroot/js/da-crypto.js` — عوض کردن کلید همهٔ داده‌های قبلی را نامعتبر می‌کند
- UI دو زبانه FA/EN (`wwwroot/locales/*.json` + `DaI18n` + `LocaleService`)؛ پیش‌فرض فارسی؛ بدون برند دوزبانه روی یک صفحه
- پرتال داخل Area: `/Panel/...` — لندینگ عمومی: `/`
- فقط یک اپ: `dotnet run --project src/Morobot.Web`

پرتال: `https://localhost:7201`  
افزونه‌ها: مسیر sync در `%LocalAppData%\morobot.soras.ir\extension-{recorder|player|selector|smart-recorder}`

```bash
dotnet run --project src/Morobot.Web --launch-profile https
```

## مستندات مرتبط

- رمزنگاری و `.mrbt` + مدل کلید آینده: [encryption-and-mrbt.md](encryption-and-mrbt.md)
- ویرایشگر: [visual-editor.md](visual-editor.md)
- رکورد/پخش: [record-play.md](record-play.md)

## قرارداد i18n (برای ایجنت بعدی)

- کلیدها در `wwwroot/locales/fa.json` و `en.json` — در Development کش سرور هر درخواست تازه خوانده می‌شود
- کلاینت: `DaI18n.t(key)` ، رویداد `da:locale` برای رندر مجدد
- صفحهٔ دیاگرام: `Areas/Panel/Views/Tasks/Editor.cshtml` + `editor/*` در locale + `flow.js` با `t("editor....")`
- تصاویر لندینگ: `img/landing/hero-{fa|en}.png` و `features-{fa|en}.png` — کلید `brand.heroImg` / `brand.featuresImg`
- وردمارک: `img/brand/morobot-wordmark-{fa|en}.svg`
- در FA هیچ متن/لوگوی انگلیسی برند نباشد؛ در EN هیچ فارسی برند نباشد (سوییچ زبان فقط نام زبان مقصد)

## رمزنگاری (MVP)

- `DaCrypto` / `DaSecureStore` در `wwwroot/js/` (+ کپی در `extension-*/lib/` در صورت نیاز)
- لیست فرآیند: `da_local_tasks__{user}` به‌صورت `mrbt1:<base64>`
- آینده (پیاده‌سازی نشده): UserPlanKey ماهانه + DEK per process + wrap دوم با GlobalSurasKey برای اشتراک

## فاز بعدی

- صدور کلید پلن بعد از خرید / تمدید
- اشتراک‌گذاری فرآیند و منبع بین کاربران با wrap DEK
- اتصال واقعی Api و همگام‌سازی سرور
