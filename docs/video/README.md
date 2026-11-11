# ویدیوی آموزشی فارسی — وباتومیتور (اپراتور)

ویدیوی معرفی و آموزش **ساخت و اجرای سناریو** در وباتومیتور، مخصوص اپراتور.
روایت فارسی (صدای Farid)، اسلایدهای راست‌به‌چپ، و اسکرین‌شات‌های واقعی پنل.

## فایل‌های خروجی

| فایل | توضیح |
|------|-------|
| `Webautomator-Tutorial-FA.mp4` | ویدیوی نهایی، ۱۹۲۰×۱۰۸۰، ۳۰fps، H.264 + AAC (حدود ۸ دقیقه) |
| `Webautomator-Tutorial-FA.srt` | زیرنویس فارسی (و به‌صورت ترک زیرنویس نرم داخل MP4) |
| `script.json` | فیلم‌نامه: متن روایت، عنوان‌ها، کارت‌ها و کال‌اوت‌های هر صحنه |
| `build/slides.pptx` | اسلایدهای قابل‌ویرایش (همان چیزی که به تصویر تبدیل می‌شود) |

## ساختار پوشه

```
docs/video/
├─ script.json                  محتوا (منبع حقیقت)
├─ build/
│  ├─ make_slides.py            script.json → slides.pptx  (+ قاب اسکرین‌شات‌ها)
│  ├─ export.ps1                slides.pptx → render/slides/*.png (PowerPoint)
│  ├─ tts.mjs                   کلاینت Edge Read-Aloud (صدای فارسی)
│  ├─ gec.py                    توکن امضای درخواست TTS
│  ├─ synth.ps1                 روایت هر صحنه + timings.json
│  ├─ make_srt.py               timings.json → SRT
│  └─ make_video.ps1            PNG + MP3 → MP4 نهایی (ffmpeg)
├─ assets/fonts/                Vazirmatn (برای اسلایدها)
├─ assets/shots/                اسکرین‌شات‌های قاب‌گرفته‌شده
├─ audio/                       روایت هر صحنه (mp3 + txt + json)
└─ render/                      خروجی‌های میانی (slides، segments)
```

## پیش‌نیازها

- **PowerPoint** (برای رندر اسلایدها؛ فونت Vazirmatn در همان اجرا به جدول فونت ویندوز اضافه می‌شود، نیازی به نصب سیستمی نیست)
- **ffmpeg** با `libx264` (مسیر پیش‌فرض در اسکریپت‌ها: `C:\Program Files\KMPlayer 64X\LAVFilters64\ffmpeg.exe`)
- **Node.js 22+** (کلاینت TTS فقط از امکانات داخلی استفاده می‌کند)
- **Python 3.10+** با `python-pptx` و `Pillow` (نسخهٔ همراه این محیط کافی است)
- دسترسی به اینترنت برای ساخت صدا (سرویس Edge Read-Aloud)

## بازسازی کامل

```powershell
cd docs/video

# ۱) اسلایدها و اسکرین‌شات‌ها
python build\make_slides.py
powershell -NoProfile -ExecutionPolicy Bypass -File build\export.ps1

# ۲) روایت (اختیاری: اگر audio/*.mp3 موجود است، می‌توانید رد کنید)
powershell -NoProfile -ExecutionPolicy Bypass -File build\synth.ps1

# ۳) زیرنویس + ویدیو
python build\make_srt.py
powershell -NoProfile -ExecutionPolicy Bypass -File build\make_video.ps1
```

## ویرایش محتوا

- **متن روایت، عنوان و کارت‌ها:** `script.json` — هر «صحنه» یک آبجکت در `beats` است.
  `kind` نوع اسلاید را تعیین می‌کند: `cover`، `section`، `points`، `steps`، `chips`،
  `shot`، `shapes`، `edges`، `flow`، `pipeline`، `checklist`، `recap`، `end`.
- **سرعت/صدای گوینده:** `meta.voice` و `meta.rate` در `script.json`
  (`fa-IR-FaridNeural` آقا، `fa-IR-DilaraNeural` خانم).
- **زمان‌بندی:** `meta.lead` (سکوت ابتدای هر صحنه) و `meta.tail` (سکوت انتهای آن).
  بعد از هر تغییر متن، `synth.ps1` را دوباره اجرا کنید تا زمان‌ها به‌روز شوند.
- **اسکرین‌شات جدید:** فایل را در `docs/marketing/screenshots/` بگذارید و در
  صحنهٔ `shot` مسیر `image` و مستطیل‌های `callouts` (مختصات نسبی ۰ تا ۱) را تنظیم کنید.
- **طراحی:** رنگ‌ها و اندازه‌ها در `build/make_slides.py` (بخش ثابت‌های بالای فایل).

## نکات فنی

- قاب اسکرین‌شات‌ها (گوشهٔ گرد + سایه + نوار مرورگر) با Pillow ساخته می‌شود تا
  در PowerPoint شفافیت و سایه درست رندر شود.
- هر صحنه در ویدیو یک حرکت آرام (Ken Burns) دارد؛ `zoom` در هر صحنه
  `in` / `out` / `pan` است.
- صدا با `loudnorm` به ‎-16 LUFS نرمال می‌شود و زیرنویس به‌صورت ترک نرم
  (`mov_text`) داخل MP4 قرار می‌گیرد.
- خروجی `render/` قابل حذف است؛ فقط برای بازسازی لازم است.

## رابطه با راهنمای پنل

ویدیو در پنل وب پخش نمی‌شود. صفحهٔ «راهنمای سامانه» (`/Panel/Home/Guide`) همین مسیر را
به‌صورت **متنی** دارد: بخش «مسیر گام‌به‌گام» با هشت فصل، هر فصل یک مقدمهٔ کوتاه، چهار قدم و
یک نکته (`Areas/Panel/Views/Shared/_GuideWalkthrough.cshtml` + کلیدهای `panel.guide.walk.*`).
متن فصل‌ها از همین `script.json` گرفته شده است، پس اگر روایت ویدیو را عوض کردید، همان
تغییر را در فایل زبان هم اعمال کنید تا دو نسخه از هم دور نشوند.

> `build/_ref_drm.py` از مخزن [rany2/edge-tts](https://github.com/rany2/edge-tts) (MIT) گرفته شده و
> فقط برای محاسبهٔ توکن `Sec-MS-GEC` سرویس Read-Aloud استفاده می‌شود؛ بقیهٔ کد ساخت ویدیو مال همین پروژه است.