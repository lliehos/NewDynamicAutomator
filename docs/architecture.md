# معماری

دو بخش فعال:

1. **Web / پرتال** `https://localhost:7201` — لاگین، ویرایشگر، `/api/*`, Area ادمین
2. **Chrome MV3** — ضبط + پخش + سلکتور؛ origin پرتال

پروژهٔ `Morobot.Api` حذف شده است؛ همهٔ API روی Web است. مسیرهای `/api/*` فقط روی Morobot.Web هستند.

```
ورود → JWT (plan + role) → EF/SQL (Processes.GraphJson)
افزونه REC (Pro) → POST /api/recordings → merge به GraphJson
ویرایش → /Panel/Tasks/Editor/{id}
  GET/PUT /api/tasks/{id}/canvas  (alias HTTP؛ entity = Process)
پخش (Free+) → Player از همان Graph JSON
ادمین → /Admin (Role=Admin)
```

بدون Selenium. بدون dual-write به جداول گراف رابطه‌ای.

`RunMode`: `Play` فعال؛ `Learn` / Smart فاز بعد (پلن Gold).

جزئیات پلن‌ها: [plans-and-tiers.md](plans-and-tiers.md).  
دامنه: [domain.md](domain.md).  
آرشیو V2: [legacy-windows-v2.md](legacy-windows-v2.md).
