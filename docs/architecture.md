# معماری

سه بخش، یک دامنه:

1. **API** `https://localhost:7101` — JWT در کوکی `da_access` و در صورت نیاز `Authorization`
2. **Web** `https://localhost:7201` — Vuexy RTL؛ لاگین؛ ویرایشگر نمودار+فهرست
3. **Chrome MV3** — رکورد + پخش قطعی (MVP)

```
پرتال لاگین → کوکی JWT
افزونه REC (همه فریم‌ها) → chrome.storage
ذخیره → POST /api/recordings
ویرایش → /Tasks/Editor/{id}  (گراف + فهرست)
پخش → GET /api/tasks/{id}/graph → resolve framePath → execute در فریم
```

بدون Selenium. صفحات هدف فریم‌تو‌فریم‌اند؛ سلکتور همیشه با `framePath` است.

ویرایش WinForms نیست: بوم گردش + فهرست همگام، گروه‌بندی، منبع تکرار روی گروه.

`RunMode`: `Play` برای فاز ۳؛ `Learn` فاز ضروری ۵ (هوک `UnexpectedStateDto` هست، رفتار Learn نه).
