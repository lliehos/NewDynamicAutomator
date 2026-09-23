# معماری

دو بخش فعال:

1. **Web / پرتال** `https://localhost:7201` — لاگین، ویرایشگر، `/api/*`, Area ادمین
2. **Chrome MV3** — ضبط + پخش + سلکتور؛ origin پرتال

پروژهٔ `Morobot.Api` حذف شده است؛ همهٔ API روی Web است. مسیرهای `/api/*` فقط روی Morobot.Web هستند.

```
ورود → JWT (plan + role + max_tasks/sources/steps) → EF/SQL
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

بدون Selenium. منابع اکسل موجودیت مستقل‌اند؛ حذف فرآیند لینک را می‌بُرد نه کتابخانه را.

Live catalog: مالک و share گیرنده‌اند؛ گروه `catalog-admins` همهٔ رویدادهای فرآیند/منبع و وضعیت اجرا را برای پنل ادمین می‌گیرد.

`RunMode`: `Play` فعال؛ `Learn` / Smart فاز بعد (پلن Gold).

جزئیات پلن‌ها: [plans-and-tiers.md](plans-and-tiers.md).  
دامنه: [domain.md](domain.md).  
آرشیو V2: [legacy-windows-v2.md](legacy-windows-v2.md).
