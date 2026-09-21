# Dynamic Automator V3

بازنویسی اتوماتور پویا بدون Selenium: API دات‌نت، پرتال Vuexy، افزونه Chrome.

**این پوشه را در Cursor باز کنید:** `C:\Projects\DynamicAutomatorV3`  
وضعیت دقیق و فازها: [docs/STATUS.md](docs/STATUS.md)

## اجرا

1. Connection string در `src/DynamicAutomator.Api/appsettings.json` و Web (پیش‌فرض LocalDB).
2. از ریشه:

```bash
dotnet run --project src/DynamicAutomator.Api
dotnet run --project src/DynamicAutomator.Web
```

- پرتال: https://localhost:7201
- API: https://localhost:7101
- ورود: `admin` / `Admin123!`
- افزونه: Load unpacked روی `extension/`
- ویرایش گردش: `/Tasks/Editor/{id}`

مایگریشن‌ها از قبل در `Infrastructure/Persistence/Migrations` هستند؛ در استارت‌آپ `MigrateAsync` زده می‌شود.

## ساختار

```
src/DynamicAutomator.Api              REST
src/DynamicAutomator.Web              پرتال + بوم گردش
src/DynamicAutomator.Domain           موجودیت / enum (از جمله RunMode)
src/DynamicAutomator.Contracts        DTO
src/DynamicAutomator.Infrastructure   EF + سرویس‌ها
extension/                            رکورد + پخش MV3
docs/                                 معماری و فازها
```
