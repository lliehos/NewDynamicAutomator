# معماری

دو بخش فعال:

1. **Web / پرتال** `https://localhost:7201` — لاگین، ویرایشگر، `/api/*`, Area ادمین
2. **Chrome MV3** — ضبط + پخش + سلکتور؛ origin پرتال

پروژهٔ `Webautomator.Api` حذف شده است؛ همهٔ API روی Web است. مسیرهای `/api/*` فقط روی Webautomator.Web هستند.

```
ورود → JWT (plan + role + max_tasks/sources/steps + session_kind) → EF/SQL
  Processes.GraphJson  +  DataSources library  +  ProcessDataSources links
افزونه REC (Pro) → POST /api/recordings → merge به GraphJson
ویرایش → /Panel/Tasks/Editor/{id}
  GET/PUT /api/tasks/{id}/canvas
  POST/DELETE /api/tasks/{id}/datasources/{dsId}  (attach/detach)
  POST /api/datasources  (کتابخانه)
پخش (Free+) → Player از Graph JSON هیدراته‌شده
ادمین → /Admin (Role=Admin) incl. Migrate / Plans caps / Sources library
  SignalR `/hubs/catalog` → JoinAdminCatalog → taskChanged / sourceChanged / playState
```

`session_version` هر توکن با شمارندهٔ **هم‌نوع خودش** سنجیده می‌شود: `SessionVersion` برای پنل/افزونه
(`session_kind=web`) و `DesktopSessionVersion` برای پلیر ویندوزی (`session_kind=desktop`). پس ورود در پنل،
پلیر ویندوزی روی همان سیستم را بیرون نمی‌کند و برعکس؛ «بستن سشن» مدیر هر دو شمارنده را بالا می‌برد.

بدون Selenium. منابع اکسل موجودیت مستقل‌اند؛ حذف فرآیند لینک را می‌بُرد نه کتابخانه را.

Live catalog: مالک و share گیرنده‌اند؛ گروه `catalog-admins` همهٔ رویدادهای فرآیند/منبع و وضعیت اجرا را برای پنل ادمین می‌گیرد.

`RunMode`: `Play` فعال؛ `Learn` / Smart فاز بعد (پلن Gold).

جزئیات پلن‌ها: [plans-and-tiers.md](plans-and-tiers.md).  
دامنه: [domain.md](domain.md).  
آرشیو V2: [legacy-windows-v2.md](legacy-windows-v2.md).

## نسخهگذاری فایلهای استاتیک (کش مرورگر)

همهٔ ارجاعهای CSS/JS در ویوها با `?v=@V.AssetVersion` میآیند (`IAppVersionService`).
استمپ ترکیبی است از نسخهٔ اسمبلی (شامل SHA گیت) و جدیدترین `LastWriteTimeUtc` زیر `wwwroot` —
پس ویرایش یک `.js`/`.css` بدون بیلد هم URL را عوض میکند.

مهم: این مقدار **در زمان اجرا** و حداکثر هر ۵ ثانیه یکبار بازمحاسبه میشود
(نه یکبار در استارت). محاسبهٔ یکباره در استارت باعث میشد ویرایش استاتیکها تا ریاستارت پروسه دیده نشود —
که در استقرار با کپی FTP (بدون تغییر DLL بدون ریاستارت) یعنی استمپ برای همیشه کهنه میماند و کاربر مجبور به Ctrl+F5 میشد.
