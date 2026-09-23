# معماری

دو بخش فعال (فعلاً بدون API جدا):

1. **Web / پرتال** `https://localhost:7201` — لاگین، ویرایشگر، و همهٔ `/api/*` برای افزونه
2. **Chrome MV3** — ضبط + پخش؛ صحبت فقط با همان origin پرتال

پروژهٔ `Morobot.Api` موقتاً کنار گذاشته شده تا فقط یک اپ لانچ شود.

```
پرتال لاگین → کوکی JWT `da_access`
افزونه REC → chrome.storage (پیش‌نویس محلی)
اتمام ضبط → انتخاب ارسال / انصراف / مجدد
ارسال → POST /api/recordings (روی پرتال)
ویرایش → /Tasks/Editor/{id}
پخش → GET /api/tasks/{id}/graph → اجرا در تب
```

بدون Selenium. سلکتور با `framePath`.

`RunMode`: `Play` MVP؛ `Learn` فاز بعد.
