# معماری

دو بخش فعال:

1. **Web / پرتال** `https://localhost:7201` — لاگین دو حالته (محلی / سرور)، ویرایشگر، `/api/*`، Area ادمین
2. **Chrome MV3** — ضبط + پخش + سلکتور؛ صحبت با origin پرتال

پروژهٔ `Morobot.Api` موقتاً کنار گذاشته شده؛ همهٔ API روی Web است.

```
ورود محلی → JWT با plan=Local → داده فقط در مرورگر
ورود سرور → JWT با plan=Free|Pro|Gold + role → EF/SQL
افزونه REC (فقط Pro) → POST /api/recordings
ویرایش → /Panel/Tasks/Editor/{id}
  Local: localStorage
  Server: GET/PUT /api/tasks/{id}/canvas
پخش (Free+) → Player روی تب هدف
ادمین → /Admin (Role=Admin)
```

بدون Selenium. سلکتور با `framePath`.

`RunMode`: `Play` فعال؛ `Learn` / Smart فاز بعد (پلن Gold).

جزئیات پلن‌ها: [plans-and-tiers.md](plans-and-tiers.md).
