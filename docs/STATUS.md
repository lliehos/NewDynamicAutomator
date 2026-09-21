# وضعیت پروژه — برای باز کردن این پوشه

مسیر: `D:\Projects\Web\NewDaynamicAutomator\NewDynamicAutomator`  
ریموت: https://github.com/lliehos/NewDynamicAutomator

## حالت فعلی: Local-first

- لاگین **فرضی** (هر یوزر؛ پیشنهاد `test` / `test`) — بدون چک سرور
- فرآیندها / ضبط / گراف در **مرورگر** (`localStorage` + `chrome.storage`)
- فقط یک اپ: `dotnet run --project src/DynamicAutomator.Web`
- پروژه Api جدا و ارسال اجباری به سرور فعلاً لازم نیست

پرتال: `https://localhost:7201`  
افزونه: نسخه `0.8.5` — Reload unpacked روی مسیر sync‌شده (`%LocalAppData%\DynamicAutomator\extension`) یا `extension/`

```bash
dotnet run --project src/DynamicAutomator.Web
```

## تغییرات اخیر (ویرایشگر + لیست فرآیند)

- سلکتور: سوئیچ پویا، سوئیچ اتریبیوت (ثابت/پویا)، زنجیره فریم زیر سلکتور، ذخیره/خواندن حافظه (`DASEL:`)
- افزونه فقط هنگام **اجرا** یا **ضبط** چک می‌شود (نه در لود اولیه صفحه)
- لیست فرآیندها: دکمه آیکونی **اجرا** و **ضبط** روی هر ردیف؛ ستون تعداد منبع؛ حذف «شروع ضبط» و «اتصال افزونه» از بالای صفحه
- ضبط از روی یک فرآیند → ذخیره در همان فرآیند (ادغام گروه ضبط‌شده)

## فاز بعدی (وقتی آماده شد)

اتصال واقعی به سرور / Api و همگام‌سازی داده‌های محلی.
