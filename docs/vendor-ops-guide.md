# راهنمای عملیات داخلی Webautomator (Vendor / پشتیبانی / مالک)

> **نسخه:** 1.1.5 · **تاریخ:** 2026-10-04  
> مخاطب: کارمند جدید پشتیبانی، DevOps، یا مالک محصول — بدون نیاز به توضیح شفاهی.

---

## فهرست

1. [نقش‌ها و اصل محرمانگی](#1-نقشها-و-اصل-محرمانگی)
2. [ساختار repository](#2-ساختار-repository)
3. [کلیدهای لایسنس](#3-کلیدهای-لایسنس)
4. [جریان لایسنس (همه نصب‌ها)](#4-جریان-لایسنس-همه-نصبها)
5. [Webautomator LicenseTool (CLI)](#5-webautomator-licensetool-cli)
6. [Webautomator Vendor Studio (WPF)](#6-webautomator-vendor-studio-wpf)
7. [ساخت بسته مشتری (publish + zip)](#7-ساخت-بسته-مشتری)
8. [ساخت بستهٔ آپدیت آفلاین](#8-ساخت-بستهٔ-آپدیت-آفلاین)
9. [تنظیمات appsettings مشتری](#9-تنظیمات-appsettings-مشتری)
10. [AppInstanceKey و افزونه Chrome](#10-appinstancekey-و-افزونه-chrome)
11. [به‌روزرسانی سامانه و دیتابیس](#11-بهروزرسانی-سامانه-و-دیتابیس)
12. [نسخه‌گذاری مستندات و kit](#12-نسخهگذاری-مستندات-و-kit)
13. [بروشور بازاریابی (PDF)](#13-بروشور-بازاریابی-pdf)
14. [عیب‌یابی رایج](#14-عیبیابی-رایج)

---

## 1. نقش‌ها و اصل محرمانگی

| نقش | مجاز | ممنوع |
|-----|------|--------|
| **Vendor / شما** | sign لایسنس، ساخت zip نصب و zip آپدیت، کلید خصوصی | نصب کلید خصوصی روی سرور مشتری |
| **مشتری (Admin)** | import لایسنس، تنظیم DB، برندینگ، آپلود/اعمال بستهٔ آپدیت آفلاین | sign لایسنس |
| **کاربر نهایی** | پنل، افزونه، اتوماسیون | Admin/License |

**هرگز** فایل `webautomator-private.pem` داخل بسته مشتری، git عمومی، یا ایمیل بدون رمزنگاری قرار نگیرد.

> بستهٔ آپدیت **امضا نمی‌شود**؛ اعتبارش از مانیفست داخلی و تطبیق SHA-256 هر فایل می‌آید. بنابراین
> تحویل آن باید از کانال مطمئن (فایل‌شر سازمانی، ایمیل رمزشده) انجام شود.

---

## 2. ساختار repository

```
src/
  Webautomator.Web/              ← اپلیکیشن مشتری / Cloud
  Webautomator.Licensing/        ← امضا و اعتبارسنجی
  Webautomator.LicenseTool/      ← CLI vendor
  Webautomator.VendorStudio/     ← UI vendor
extension-global/           ← افزونه Webautomator Global
extension-smart-recorder/   ← Smart Recorder (جدا)
docs/
  setup-guide.md            ← راهنمای مشتری (استقرار + آپدیت آفلاین)
  vendor-ops-guide.md       ← همین سند
  visual-editor.md          ← فهرست انواع اقدام و شرط ویرایشگر
  play-engine-logic.md      ← رفتار واقعی موتور اجرا + فهرست ایرادهای باز
  marketing/webautomator-brochure.html  ← چاپ PDF برای فروش
tools/
  vendor-kit/               ← اسکریپت zip kit داخلی
  license-keys/             ← فقط .gitkeep در git؛ PEM محلی
```

---

## 3. کلیدهای لایسنس

### 3.1 اولین بار (یک بار در سازمان)

```powershell
cd d:\path\to\repo
dotnet run --project src\Webautomator.LicenseTool -- genkeypair --out-dir tools\license-keys
```

خروجی:
- `webautomator-public.pem` → embed در `Webautomator.Licensing` / build اپ
- `webautomator-private.pem` → **فقط offline** برای sign

### 3.2 چرخش کلید

کلید جدید = لایسنس‌های جدید با public key جدید در اپ. مشتری‌های قدیمی تا زمان upgrade لایسنس/اپ هماهنگ می‌مانند. با مالک هماهنگ کنید.

---

## 4. جریان لایسنس (همه نصب‌ها)

```
[مشتری] نصب Webautomator (بدون لایسنس → trial)
    ↓
[مشتری Admin] /Admin/License → Export activation-request.json
    ↓
[شما] sign با private key → license.webautomator
    ↓
[مشتری Admin] Import license.webautomator
    ↓
(اختیاری) restart برای connection string داخل لایسنس
```

**نکته:** import لایسنس **کاربران و فرآیندها را حذف نمی‌کند**.

**دوره آزمایشی:** به اثر انگشت سرور (`DeploymentTrialRecords`) گره خورده است؛ پاک کردن فقط `DeploymentAnchors` برای reset کافی نیست. هر entitlement یک `InstanceId` دارد — کاربر/فرآیند با InstanceId قدیمی بدون لایسنس کار نمی‌کند. **Import لایسنس معتبر** همه ردیف‌ها را به Instance فعلی وصل می‌کند (داده پاک نمی‌شود). لایسنس همچنان به `DeploymentAnchorId` در activation-request وابسته است.

**Upgrade سقف کاربر:** لایسنس جدید با `Sequence` بالاتر.

---

## 5. Webautomator LicenseTool (CLI)

```powershell
# راهنما
dotnet run --project src\Webautomator.LicenseTool -- help

# امضا
dotnet run --project src\Webautomator.LicenseTool -- sign `
  --request C:\temp\activation-request.json `
  --private-key tools\license-keys\webautomator-private.pem `
  --valid-until 2027-12-31 `
  --org "نام سازمان" `
  --max-users 100 `
  --sequence 1 `
  --allowed-host "automation.customer.ir" `
  --trial-days 3 `
  --allow-updates true `
  --db-connection "Server=...;Database=WebautomatorDb;..." `
  -o C:\temp\license.webautomator

# verify
dotnet run --project src\Webautomator.LicenseTool -- verify --license C:\temp\license.webautomator

# بسته سرور
dotnet run --project src\Webautomator.LicenseTool -- package `
  --project src\Webautomator.Web\Webautomator.Web.csproj `
  --output dist\webautomator-server-acme

# بستهٔ آپدیت آفلاین (بخش ۸)
dotnet run --project src\Webautomator.LicenseTool -- package-update `
  --version 3.0.1 `
  --source dist\webautomator-server-acme `
  --output dist\webautomator-update-3.0.1.zip `
  --notes "رفع اشکال پنل منابع" `
  --channel stable `
  --min-current 2.9.0
```

### 5.1 پرچم‌های لایسنس

| پرچم | پیش‌فرض | کاربرد |
|------|:-------:|--------|
| `--allow-updates` | `true` | اجازهٔ بررسی/اعمال آپدیت (آنلاین و آفلاین) |
| `--allow-legacy-migration` | **`false`** | فعال‌کردن «انتقال از دیتابیس قدیمی» (`/Admin/Migrate`) |
| `--trial-days` | `3` | مدت دورهٔ آزمایشی پیش از لایسنس |
| `--sequence` | `1` | شمارهٔ نسخهٔ لایسنس — **نباید کم شود** |
| `--allowed-host` | — | قفل دامنه/IP |
| `--update-url` | — | بازنویسی آدرس بررسی آپدیت |

> **`--allow-legacy-migration` عمداً پیش‌فرض `false` است.** انتقال از دیتابیس قدیمی فقط برای
> مشتری‌ای فعال می‌شود که در قراردادش مجوز گرفته باشد. بدون این پرچم، لینک منوی «انتقال از قدیمی»
> نمایش داده نمی‌شود و `/Admin/Migrate` کد **۴۰۴** برمی‌گرداند.

---

## 6. Webautomator Vendor Studio (WPF)

```powershell
dotnet run --project src\Webautomator.VendorStudio
```

**تب ۱ — لایسنس:**

1. بارگذاری activation-request
2. تنظیم تاریخ اعتبار / سازمان / MaxUsers / DB / دامنهٔ مجاز
3. تعیین پرچم‌ها: **Allow updates** و **Allow legacy migration** (به‌صورت پیش‌فرض خاموش)
4. Sign → Save `.webautomator`

**تب ۲ — بسته نصب:**

1. مسیر `Webautomator.Web.csproj` و پوشهٔ خروجی
2. Publish → ساخت `webautomator-server.zip`

**تب ۳ — بسته آپدیت:**

1. **پوشهٔ فایل‌های publish** (معمولاً همان خروجی تب ۲ — با دکمهٔ «از تب نصب» پر می‌شود)
2. **نسخهٔ بسته** — باید از نسخهٔ نصب‌شدهٔ مشتری بزرگ‌تر باشد (مثل آسمبلی سرور)
3. یادداشت نسخه (اختیاری) — در صفحهٔ آپدیت مشتری نمایش داده می‌شود
4. حداقل نسخهٔ فعلی (اختیاری) و کانال (پیش‌فرض `stable`)
5. مسیر فایل خروجی zip → «ساخت بسته آپدیت»

این تب از **همان builder** ابزار CLI استفاده می‌کند، پس بستهٔ ساخته‌شده با بستهٔ CLI یکسان است و
سرور هر دو را یکسان می‌پذیرد.

پس از publish، `appsettings.json` را برای مشتری تنظیم کنید (بخش ۹).

---

## 7. ساخت بسته مشتری

خروجی استاندارد:
- پوشه publish (شامل `Webautomator.Web.exe` یا `.dll`، `appsettings.json`, `docs/setup-guide.md`)
- فایل `webautomator-server.zip`
- **بدون** private key
- **بدون** سورس git

Checklist قبل از ارسال:
- [ ] `Webautomator:AppInstanceKey` یکتا برای این مشتری/دامنه
- [ ] لایسنس روی همه نصب‌ها فعال است (تغییر DeploymentMode دور نمی‌زند)
- [ ] `ConnectionStrings:Default` یا connection در لایسنس
- [ ] راهنمای `setup-guide.md` داخل `docs/`
- [ ] **بدون** `webautomator-private.pem`

---

## 8. ساخت بستهٔ آپدیت آفلاین

برای مشتری‌ای که سرورش به اینترنت دسترسی ندارد. بسته یک zip خودتوصیف است که سرور پیش از
هر تغییری آن را اعتبارسنجی می‌کند.

### 8.1 ساخت

```powershell
dotnet run --project src\Webautomator.LicenseTool -- package-update `
  --version 3.0.1 `
  --source dist\webautomator-server-acme `
  --output dist\webautomator-update-3.0.1.zip `
  --notes "رفع اشکال گزارش منابع" `
  --channel stable `
  --min-current 2.9.0
```

یا از **Vendor Studio → تب «بسته آپدیت»** (همان خروجی، با رابط گرافیکی).

### 8.2 داخل بسته

```
webautomator-update.json   ← مانیفست: version، notes، minCurrentVersion، SHA-256 هر فایل
update.ps1            ← اسکریپت اعمال آپدیت (Windows)
<فایل‌های publish>     ← همان خروجی publish، به‌علاوه wwwroot و ...
```

- مانیفست **آخر از همه** نوشته می‌شود، پس هرگز فایلی را توصیف نمی‌کند که در بسته نیست.
- پوشه‌های `updates/staged/**` و `updates/uploaded/**` عمداً نادیده گرفته می‌شوند.

### 8.3 سرور مشتری چه می‌کند

`/Admin/OfflineUpdate` → آپلود zip → سامانه:

1. مانیفست را می‌خواند (رد کردن فایل غیربسته با پیام روشن)
2. `version` را با نسخهٔ نصب‌شده مقایسه می‌کند — **باید جدیدتر باشد**
3. `minCurrentVersion` را بررسی می‌کند
4. **SHA-256 هر فایل** را تطبیق می‌دهد؛ در صورت مغایرت، بسته رد می‌شود
5. مسیرهای `..` و مطلق را رد می‌کند (هیچ فایلی خارج از `updates/staged` نوشته نمی‌شود)
6. فقط پس از همهٔ این‌ها، فایل‌ها را در `updates/staged/current` استخراج می‌کند

### 8.4 اعمال روی سرور مشتری

مشتری سرویس را متوقف می‌کند، تیک تأیید را می‌زند و «اعمال آپدیت و راه‌اندازی مجدد» را انتخاب
می‌کند. `update.ps1`:

- **پیش از کپی** بررسی می‌کند فایل‌های برنامه قفل نباشند؛ اگر سرویس در حال اجرا باشد با کد
  خروج **۳** و پیام «Application still running» متوقف می‌شود (نیمه‌اعمال نمی‌کند)
- فایل‌ها را کپی می‌کند، `update.ps1` / `update.log` / `webautomator-update.json` را کپی **نمی‌کند**
- با سوئیچ `-Restart` برنامه را با `RestartCommand` (یا اولین exe پوشهٔ مقصد) اجرا می‌کند
- هر مرحله را در `update.log` کنار اسکریپت ثبت می‌کند

**Linux:** مشتری محتوای بسته را دستی روی پوشهٔ نصب کپی و سرویس را restart می‌کند.

### 8.5 تست پیش از تحویل

بسته را روی یک نصب آزمایشی همان مشتری (یا dev) آپلود و اعمال کنید:

- [ ] آپلود بسته پیام «بستهٔ نسخه X بررسی و آماده شد» می‌دهد
- [ ] کارت «بستهٔ آماده‌شده» نسخه و زمان را نشان می‌دهد
- [ ] اعمال با موفقیت انجام و `update.log` نوشته می‌شود
- [ ] پس از restart، نسخهٔ جدید در `/Admin/License` و لاگ migration دیده می‌شود

> پس از اعمال، migrationهای EF Core روی **اولین اجرا** اعمال می‌شوند — بخش ۱۱.

---

## 9. تنظیمات appsettings مشتری

```json
{
  "ConnectionStrings": {
    "Default": "Server=...;Database=WebautomatorDb;..."
  },
  "Webautomator": {
    "DeploymentMode": "Enterprise",
    "AppInstanceKey": "acme-prod",
    "OfflineUpdate": {
      "MaxUploadMegabytes": 512,
      "RestartCommand": ""
    }
  }
}
```

| کلید | معنی |
|------|------|
| `DeploymentMode` | برچسب اختیاری (`Cloud` / `Enterprise`) — **لایسنس را کنترل نمی‌کند** |
| `AppInstanceKey` | شناسه یکتا این استقرار (برای جداسازی افزونه روی PC) |
| `ConnectionStrings:Default` | SQL Server — **موتور فقط SQL Server** در نسخه فعلی |
| `OfflineUpdate:UploadDirectory` | پوشهٔ آرشیوهای آپلودشده (پیش‌فرض `updates/uploaded`) |
| `OfflineUpdate:StagingDirectory` | پوشهٔ استخراج بستهٔ تأییدشده (پیش‌فرض `updates/staged`) |
| `OfflineUpdate:MaxUploadMegabytes` | سقف حجم فایل آپلود (پیش‌فرض `512`) |
| `OfflineUpdate:RestartCommand` | دستور راه‌اندازی مجدد پس از اعمال (خالی = اولین exe پوشهٔ مقصد) |

---

## 10. AppInstanceKey و افزونه Chrome

مسیر همگام‌سازی افزونه روی ماشینی که **Webautomator.Web** اجرا می‌شود (یا dev محلی):

```
%LOCALAPPDATA%\webautomator\extension-global
%LOCALAPPDATA%\webautomator\extension-smart-recorder
```

**چرا لازم است؟** یک کارمند ممکن است همزمان:
- Cloud روی `app1.webautomator.ir`
- Cloud روی `app2.webautomator.ir`
- Enterprise روی `webautomator.company.local`

باز کند — هر استقرار **AppInstanceKey** جدا → پوشه افزونه جدا → بدون overwrite.

**قانون نام‌گذاری:** فقط حروف، عدد، `-`, `_`, `.` — مثلاً `cloud-prod-ir`, `acme-onprem`.

**مشتری Cloud چند tenant:** برای هر tenant/دامنه جدا، `AppInstanceKey` جدا در appsettings همان deployment.

> **افزونه فقط با پنلِ همان سرور کار می‌کند:** افزونه هنگام باز شدن پنل، `/extension/fingerprint` را
> `fetch` می‌کند و اگر اثر انگشت با `webautomator-binding.json` نخواند، پنل را علامت‌دار نمی‌کند. اگر گواهی
> سرور از **CA داخلی** است، گواهی **ریشه** باید در مخزن Trusted Root هر کلاینت نصب باشد؛ چون کلیک روی
> «Proceed» هشدار مرورگر فقط روی بارگذاری خود صفحه اثر دارد و درخواست افزونه را باز نمی‌کند
> (راهنمای گام‌به‌گام: `setup-guide.md` بخش ۷.۷).
>
> **پوشهٔ نصب را ثابت نگه دارید:** بسته را در یک مسیر دائمی (پیش‌فرض `%LOCALAPPDATA%\webautomator\…`)
> استخراج و از همان مسیر Load unpacked کنید. اگر از `Downloads` نصب کنید، هر دانلود یک پوشهٔ
> `webautomator-global (2)` / `(3)` تازه می‌سازد، کروم همان نسخهٔ قدیمی را اجرا می‌کند و آپدیت هیچ اثری ندارد.

> **آیکون برند:** `icons/icon16|32|48|128.png` در پوشهٔ افزونه از آیکون برند ساخته می‌شوند
> (پیش‌فرض `wwwroot/img/brand/webautomator-icon.png`). منبع باید **PNG واقعی** باشد؛ اگر دادهٔ JPEG
> داخل فایلی با پسوند `.png` نوشته شود، endpoint protection سازمانی آن را «دست‌کاری فایل تصویری»
> می‌بیند، نوشتن را بلاک می‌کند و آیکون خراب می‌ماند (بخش ۱۴).

---

## 11. به‌روزرسانی سامانه و دیتابیس

در **اولین اجرا** پس از جایگزینی باینری:

1. اتصال SQL برقرار می‌شود
2. در صورت نبود DB → CREATE DATABASE
3. **`MigrateAsync`** — migrationهای EF Core اعمال می‌شوند
4. Seed در صورت نیاز

نیازی به `dotnet ef database update` دستی روی سرور مشتری نیست (مگر troubleshooting).

**شما هنگام release:**
- migration جدید در `src/Webautomator.Infrastructure/Persistence/Migrations/` commit کنید
- در release note بنویسید «پس از آپدیت یک بار restart»
- نسخهٔ منتشرشده را در `Webautomator:UpdateFeed` (appsettings یا env روی webautomator.ir) به‌روز کنید — endpoint عمومی `GET /checkupdate?current=…`

```json
"Webautomator": {
  "UpdateFeed": {
    "LatestVersion": "3.0.1",
    "ReleaseNotes": "…",
    "DownloadUrl": "https://webautomator.ir/download",
    "PublishedUtc": "2026-09-25T00:00:00Z"
  }
}
```

نصب‌های مشتری با لایسنس «AllowUpdates» همان URL را (یا `UpdateServerUrl` در تنظیمات) poll می‌کنند.

**رفتار سرور مشتری:** سامانه هر **۶ ساعت** یک‌بار بررسی می‌کند. با پیدا شدن نسخهٔ جدید، به مدیر
اعلان لحظه‌ای (SignalR، گروه `catalog-admins`) فرستاده می‌شود و نسخه/یادداشت/لینک در تنظیمات
کش می‌شود. برای مشتری بدون اینترنت، از **بستهٔ آپدیت آفلاین** (بخش ۸) استفاده کنید.

**مشاهده‌پذیری migration:** تعداد migrationهای در انتظار اعمال در لاگ راه‌اندازی ثبت می‌شود
(`Applying N pending migration(s)`)؛ در صورت شکست، پیام خطا نام migration مشکل‌دار را همراه با
خطای اصلی نشان می‌دهد.

---

## 12. نسخه‌گذاری مستندات و kit

فایل مرجع: `docs/doc-versions.json`

| سند | وقتی عوض شد |
|-----|-------------|
| setup-guide.md | نسخه در سربرگ + doc-versions |
| vendor-ops-guide.md | همین |
| webautomator-brochure.html | marketingBrochure |

ساخت zip kit برای کارمند جدید:

```powershell
.\tools\vendor-kit\BUILD-VENDOR-KIT.ps1 -Version 1.0.0
```

خروجی: `dist/webautomator-vendor-kit-v1.0.0.zip`

---

## 13. بروشور بازاریابی (PDF)

1. باز کنید: `docs/marketing/webautomator-brochure.html` در Chrome/Edge
2. Ctrl+P → **Save as PDF**
3. به مشتری احتمالی بدهید

محتوا: معرفی برند، **تاریخچه نسل‌های نرم‌افزار اتوماسیون مشابه** (نه جزئیات vendor)، امکانات، مزایا — اسکرین‌شات‌ها در `docs/marketing/screenshots/`.

---

## 14. عیب‌یابی رایج

| مشکل | اقدام |
|------|--------|
| لایسنس invalid | activation-request تازه؛ Anchor عوض نشده باشد |
| Sequence rollback | sequence جدید > قبلی |
| مشتری می‌گوید «انتقال از قدیمی» را نمی‌بیند | پرچم `allowLegacyMigration` در لایسنس او خاموش است؛ لایسنس جدید با `--allow-legacy-migration true` و `--sequence` بالاتر صادر کنید |
| افزونه اشتباه به سرور | پنل همان دامنه را باز کنید؛ AppInstanceKey درست |
| پنل می‌گوید «افزونه نصب نیست» / «افزونهٔ اجرا لازم است»، ولی افزونه نصب است و Load unpacked دوباره هم اثری ندارد | گواهی ریشهٔ سرور روی آن کلاینت در **Trusted Root** نصب نیست. افزونه برای تأیید سرور `/extension/fingerprint` را `fetch` می‌کند و «Proceed» هشدار مرورگر آن را باز نمی‌کند، پس پراب بی‌صدا شکست می‌خورد و پل صفحه را علامت‌دار نمی‌کند. سریع‌ترین رفع: `tools/Run-InstallRootCA.cmd` را روی کلاینت اجرا کنید (کاربر بدون ادمین: `-Scope User` که یک دیالوگ **Security Warning** ویندوزی دارد و باید Yes بزند؛ فقط بررسی: `-DryRun`) — خودش نصب می‌کند و با handshake واقعی تأیید می‌کند. تست دستی: `(Invoke-WebRequest https://<host>/extension/fingerprint -UseBasicParsing).Content` (یا curl با `--ssl-no-revoke`؛ بدون آن، curl خطای گمراه‌کنندهٔ `CRYPT_E_NO_REVOCATION_CHECK` می‌دهد چون ریشهٔ داخلی CRL ندارد). اگر مشتری شبکه توزیع نرم‌افزار دارد، بستهٔ MSI آماده (`tools/installer/Build-RootCaMsi.ps1` → `WebautomatorRootCA-<ver>.msi`) را تحویل دهید: `msiexec /i … /qn /norestart` آن را روی همهٔ کلاینت‌ها نصب می‌کند و `/x` هم برش می‌دارد (حذف با thumbprint). جزئیات: `setup-guide.md` بخش ۷.۷ |
| بعد از کوچ سرور به ماشین/VM/کانتینر جدید، همهٔ کلاینت‌ها پیام «افزونه به سرور دیگری تعلق دارد» می‌گیرند | اثر انگشت سرور از `MachineGuid` + نام ماشین + تعداد هسته + پلتفرم ساخته می‌شود و با جابجایی استقرار عوض می‌شود. هر کلاینت باید بستهٔ سرور جدید را از پنل ← نصب افزونه‌ها بگیرد و Load unpacked کند |
| دو Cloud روی یک PC | AppInstanceKey متفاوت + Load unpacked از دو مسیر |
| Migration fail | لاگ startup؛ دسترسی SQL؛ نسخه اپ با migration هماهنگ |
| بستهٔ آپدیت رد می‌شود | مانیفست (`webautomator-update.json`) موجود باشد؛ `version` جدیدتر از نصب مشتری؛ `minCurrentVersion` رعایت شده؛ پیام دقیق در `/Admin/OfflineUpdate` |
| اعمال آپدیت روی Windows انجام نمی‌شود | سرویس مشتری هنوز در حال اجراست (کد خروج ۳)؛ `update.log` را بخوانید |
| `uploads/` و `updates/` در git ظاهر می‌شوند | این دو پوشه در `.gitignore` هستند؛ اگر دیده می‌شوند، سیاست repo را بررسی کنید |
| آنتی‌ویروس هنگام اجرا به `…\webautomator\extension-*\icons\icon16.png` گیر می‌دهد، یا آیکون خراب/پرِ صفر می‌شود | آیکون برند باید PNG **واقعی** باشد (نه JPEG/WebP با پسوند `.png`)؛ منبع پیش‌فرض `wwwroot/img/brand/webautomator-icon.png` است. پس از اصلاح فایل، صفحهٔ نصب را باز کنید یا اپ را ری‌استارت کنید تا Sync فایل‌های آیکون را ترمیم کند — نیازی به حذف دستی پوشهٔ افزونه نیست |

---

## تماس داخلی

مسائل کلید خصوصی، pricing، و SLA → مالک محصول / مدیریت.
