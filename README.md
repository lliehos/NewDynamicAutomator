# Dynamic Automator V3

بازنویسی اتوماتور پویا بدون Selenium: پرتال ASP.NET + بوم گردش، افزونه Chrome MV3.

وضعیت دقیق و فازها: [docs/STATUS.md](docs/STATUS.md)

## اجرا (local-first)

```bash
dotnet run --project src/DynamicAutomator.Web
```

- پرتال: https://localhost:7201
- ورود فرضی (مثلاً `test`)
- افزونه: Load unpacked — مسیر sync یا پوشه `extension/` (نسخه فعلی در STATUS)
- ویرایش گردش: `/Tasks/Editor/{id}`

مایگریشن‌ها در استارت‌آپ با `MigrateAsync` اعمال می‌شوند.

## ساختار

```
src/DynamicAutomator.Web              پرتال + بوم گردش
src/DynamicAutomator.Domain           موجودیت / enum
src/DynamicAutomator.Contracts        DTO
src/DynamicAutomator.Infrastructure   EF + سرویس‌ها
extension/                            رکورد + پخش MV3
docs/                                 معماری و فازها
```

جزئیات رکورد/پخش: [docs/record-play.md](docs/record-play.md) — ویرایشگر: [docs/visual-editor.md](docs/visual-editor.md)
