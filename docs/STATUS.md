# وضعیت پروژه — برای باز کردن این پوشه

مسیر: `C:\Projects\DynamicAutomatorV3`  
ریموت: https://github.com/lliehos/NewDynamicAutomator

## حالت فعلی: Local-first

- لاگین **فرضی** (هر یوزر؛ پیشنهاد `test` / `test`) — بدون چک سرور
- فرآیندها / ضبط / گراف در **مرورگر** (`localStorage` + `chrome.storage`)
- فقط یک اپ: `dotnet run --project src/DynamicAutomator.Web`
- پروژه Api جدا و ارسال اجباری به سرور فعلاً لازم نیست

پرتال: `https://localhost:7201`  
افزونه: نسخه `0.7.0` — Reload unpacked روی `extension/`

```bash
dotnet run --project src/DynamicAutomator.Web
```

## فاز بعدی (وقتی آماده شد)

اتصال واقعی به سرور / Api و همگام‌سازی داده‌های محلی.
