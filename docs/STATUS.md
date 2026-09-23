# وضعیت پروژه — برای باز کردن این پوشه

مسیر ورک‌اسپیس فعلی؛ ریموت: https://github.com/lliehos/NewDynamicAutomator

برنچ فعال توسعه: `feature/tiers-admin-stage1`

## حالت فعلی: سطوح کاربر + سرور + ادمین (بدون AI)

- **سطح Local (تست):** لاگین حالت محلی؛ سقف ۱ فرآیند / ۱ منبع؛ بدون Play / Selector / Record
- **سطح Free:** لاگین سرور (`free` / `Free123!`)؛ سقف ۳/۳؛ Play + Selector
- **سطح Pro:** لاگین سرور (`pro` / `Pro123!`)؛ نامحدود + Record
- **سطح Gold:** اسکلت پلن در DB؛ Smart بعداً
- **ادمین:** `admin` / `Admin123!` → Area `/Admin` (کاربران، پلن‌ها، قیمت‌ها، فرآیندها)
- **سطح Local:** حساب سیستمی `guest` (پلن Local؛ سقف ۱/۱؛ بدون Play/Selector/Record)
- **سطح Free / Pro / Admin:** پلن از روی یوزرنیم حساب در DB
- فرم لاگین فقط یوزر/پسورد — بدون انتخاب حالت local/server
- نام‌های رزرو (`admin`,`free`,`pro`,`guest`,`test`,…) برای ساخت کاربر جدید مجاز نیست
- همه فرآیند/منبع روی سرور؛ EventLog + Devices در ادمین
- فقط یک اپ: `dotnet run --project src/Morobot.Web`

پرتال: `https://localhost:7201`  
افزونه‌ها: `%LocalAppData%\morobot.soras.ir\extension-{recorder|player|selector|smart-recorder}`

```bash
dotnet run --project src/Morobot.Web --launch-profile https
```

## مستندات مرتبط

- سطوح و پلن‌ها: [plans-and-tiers.md](plans-and-tiers.md)
- معماری: [architecture.md](architecture.md)
- رمزنگاری و `.mrbt`: [encryption-and-mrbt.md](encryption-and-mrbt.md)
- ویرایشگر: [visual-editor.md](visual-editor.md)
- رکورد/پخش: [record-play.md](record-play.md)

## خارج از اسکوپ این برنچ

- Learn / Smart / قابلیت‌های سطح طلایی (AI)
- درگاه پرداخت (قیمت‌ها فقط مدیریت ادمین)
