# Morobot V3 — مروبات / Morobot

بازنویسی پنل بدون Selenium: پرتال ASP.NET + بوم گردش + افزونه‌های Chrome MV3.

وضعیت و قراردادها: [docs/STATUS.md](docs/STATUS.md)  
**راهنمای جامع راه‌اندازی (Enterprise / on-prem):** [docs/setup-guide.md](docs/setup-guide.md) — در وب: `/Home/SetupGuide`  
رمزنگاری محلی و `.mrbt`: [docs/encryption-and-mrbt.md](docs/encryption-and-mrbt.md)

## اجرا (local-first)

```bash
dotnet run --project src/Morobot.Web --launch-profile https
```

- لندینگ: https://localhost:7201/
- پنل: https://localhost:7201/Panel
- ورود فرضی (مثلاً `test`)
- زبان: کوکی `da_culture` (`fa` پیش‌فرض / `en`)
- افزونه: Load unpacked از مسیر sync یا پوشه‌های `extension-*`

## ساختار مهم

```
src/Morobot.Web/Areas/Panel   پنل احرازشده
src/Morobot.Web/Views/Home    لندینگ عمومی
wwwroot/locales                        fa.json / en.json
wwwroot/js/da-crypto.js                AES-GCM + .mrbt
wwwroot/js/da-secure-store.js          localStorage رمزشده
wwwroot/editor/flow.js                 طراح دیاگرام
extension-global|extension-smart-recorder   افزونه Global + Smart
docs/                                  معماری و فازها
```

جزئیات رکورد/پخش: [docs/record-play.md](docs/record-play.md) — ویرایشگر: [docs/visual-editor.md](docs/visual-editor.md)
