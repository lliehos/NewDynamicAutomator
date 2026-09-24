# راهنمای عملیات داخلی Morobot (Vendor / پشتیبانی / مالک)

> **نسخه:** 1.0.1 · **تاریخ:** 2026-09-24  
> مخاطب: کارمند جدید پشتیبانی، DevOps، یا مالک محصول — بدون نیاز به توضیح شفاهی.

---

## فهرست

1. [نقش‌ها و اصل محرمانگی](#1-نقشها-و-اصل-محرمانگی)
2. [ساختار repository](#2-ساختار-repository)
3. [کلیدهای لایسنس](#3-کلیدهای-لایسنس)
4. [جریان لایسنس (همه نصب‌ها)](#4-جریان-لایسنس-همه-نصبها)
5. [Morobot LicenseTool (CLI)](#5-morobot-licensetool-cli)
6. [Morobot Vendor Studio (WPF)](#6-morobot-vendor-studio-wpf)
7. [ساخت بسته مشتری (publish + zip)](#7-ساخت-بسته-مشتری)
8. [تنظیمات appsettings مشتری](#8-تنظیمات-appsettings-مشتری)
9. [AppInstanceKey و افزونه Chrome](#9-appinstancekey-و-افزونه-chrome)
10. [به‌روزرسانی سامانه و دیتابیس](#10-بهروزرسانی-سامانه-و-دیتابیس)
11. [نسخه‌گذاری مستندات و kit](#11-نسخهگذاری-مستندات-و-kit)
12. [بروشور بازاریابی (PDF)](#12-بروشور-بازاریابی-pdf)
13. [عیب‌یابی رایج](#13-عیبیابی-رایج)

---

## 1. نقش‌ها و اصل محرمانگی

| نقش | مجاز | ممنوع |
|-----|------|--------|
| **Vendor / شما** | sign لایسنس، ساخت zip، کلید خصوصی | نصب کلید خصوصی روی سرور مشتری |
| **مشتری (Admin)** | import لایسنس، تنظیم DB، برندینگ | sign لایسنس |
| **کاربر نهایی** | پنل، افزونه، اتوماسیون | Admin/License |

**هرگز** فایل `morobot-private.pem` داخل بسته مشتری، git عمومی، یا ایمیل بدون رمزنگاری قرار نگیرد.

---

## 2. ساختار repository

```
src/
  Morobot.Web/              ← اپلیکیشن مشتری / Cloud
  Morobot.Licensing/        ← امضا و اعتبارسنجی
  Morobot.LicenseTool/      ← CLI vendor
  Morobot.VendorStudio/     ← UI vendor
extension-global/           ← افزونه Morobot Global
extension-smart-recorder/   ← Smart Recorder (جدا)
docs/
  setup-guide.md            ← راهنمای مشتری (استقرار)
  vendor-ops-guide.md       ← همین سند
  marketing/morobot-brochure.html  ← چاپ PDF برای فروش
tools/
  vendor-kit/               ← اسکریپت zip kit داخلی
  license-keys/             ← فقط .gitkeep در git؛ PEM محلی
```

---

## 3. کلیدهای لایسنس

### 3.1 اولین بار (یک بار در سازمان)

```powershell
cd d:\path\to\repo
dotnet run --project src\Morobot.LicenseTool -- genkeypair --out-dir tools\license-keys
```

خروجی:
- `morobot-public.pem` → embed در `Morobot.Licensing` / build اپ
- `morobot-private.pem` → **فقط offline** برای sign

### 3.2 چرخش کلید

کلید جدید = لایسنس‌های جدید با public key جدید در اپ. مشتری‌های قدیمی تا زمان upgrade لایسنس/اپ هماهنگ می‌مانند. با مالک هماهنگ کنید.

---

## 4. جریان لایسنس (همه نصب‌ها)

```
[مشتری] نصب Morobot (بدون لایسنس → trial)
    ↓
[مشتری Admin] /Admin/License → Export activation-request.json
    ↓
[شما] sign با private key → license.morobot
    ↓
[مشتری Admin] Import license.morobot
    ↓
(اختیاری) restart برای connection string داخل لایسنس
```

**نکته:** import لایسنس **کاربران و فرآیندها را حذف نمی‌کند**.

**دوره آزمایشی:** به اثر انگشت سرور (`DeploymentTrialRecords`) گره خورده است؛ پاک کردن فقط `DeploymentAnchors` برای reset کافی نیست. هر entitlement یک `InstanceId` دارد — کاربر/فرآیند با InstanceId قدیمی بدون لایسنس کار نمی‌کند. **Import لایسنس معتبر** همه ردیف‌ها را به Instance فعلی وصل می‌کند (داده پاک نمی‌شود). لایسنس همچنان به `DeploymentAnchorId` در activation-request وابسته است.

**Upgrade سقف کاربر:** لایسنس جدید با `Sequence` بالاتر.

---

## 5. Morobot LicenseTool (CLI)

```powershell
# راهنما
dotnet run --project src\Morobot.LicenseTool -- help

# امضا
dotnet run --project src\Morobot.LicenseTool -- sign `
  --request C:\temp\activation-request.json `
  --private-key tools\license-keys\morobot-private.pem `
  --valid-until 2027-12-31 `
  --org "نام سازمان" `
  --max-users 100 `
  --sequence 1 `
  --allowed-host "automation.customer.ir" `
  --trial-days 3 `
  --allow-updates true `
  --db-connection "Server=...;Database=MorobotV3;..." `
  -o C:\temp\license.morobot

# verify
dotnet run --project src\Morobot.LicenseTool -- verify --license C:\temp\license.morobot

# بسته سرور
dotnet run --project src\Morobot.LicenseTool -- package `
  --project src\Morobot.Web\Morobot.Web.csproj `
  --output dist\morobot-server-acme
```

---

## 6. Morobot Vendor Studio (WPF)

```powershell
dotnet run --project src\Morobot.VendorStudio
```

1. **License:** بارگذاری activation-request، تنظیم تاریخ/سازمان/MaxUsers/DB → Sign → Save `.morobot`
2. **Package:** مسیر csproj و پوشه خروجی → Publish → zip

پس از publish، `appsettings.json` را برای مشتری تنظیم کنید (بخش 8).

---

## 7. ساخت بسته مشتری

خروجی استاندارد:
- پوشه publish (شامل `Morobot.Web.exe` یا `.dll`، `appsettings.json`, `docs/setup-guide.md`)
- فایل `morobot-server.zip`
- **بدون** private key
- **بدون** سورس git

Checklist قبل از ارسال:
- [ ] `Morobot:AppInstanceKey` یکتا برای این مشتری/دامنه
- [ ] لایسنس روی همه نصب‌ها فعال است (تغییر DeploymentMode دور نمی‌زند)
- [ ] `ConnectionStrings:Default` یا connection در لایسنس
- [ ] راهنمای `setup-guide.md` داخل `docs/`

---

## 8. تنظیمات appsettings مشتری

```json
{
  "ConnectionStrings": {
    "Default": "Server=...;Database=MorobotV3;..."
  },
  "Morobot": {
    "DeploymentMode": "Enterprise",
    "AppInstanceKey": "acme-prod"
  }
}
```

| کلید | معنی |
|------|------|
| `DeploymentMode` | برچسب اختیاری (`Cloud` / `Enterprise`) — **لایسنس را کنترل نمی‌کند** |
| `AppInstanceKey` | شناسه یکتا این استقرار (برای جداسازی افزونه روی PC) |
| `ConnectionStrings:Default` | SQL Server — **موتور فقط SQL Server** در نسخه فعلی |

---

## 9. AppInstanceKey و افزونه Chrome

مسیر همگام‌سازی افزونه روی ماشینی که **Morobot.Web** اجرا می‌شود (یا dev محلی):

```
%LOCALAPPDATA%\morobot.soras.ir\{AppInstanceKey}\extension-global
%LOCALAPPDATA%\morobot.soras.ir\{AppInstanceKey}\extension-smart-recorder
```

**چرا لازم است؟** یک کارمند ممکن است همزمان:
- Cloud روی `app1.morobot.ir`
- Cloud روی `app2.morobot.ir`
- Enterprise روی `morobot.company.local`

باز کند — هر استقرار **AppInstanceKey** جدا → پوشه افزونه جدا → بدون overwrite.

**قانون نام‌گذاری:** فقط حروف، عدد، `-`, `_`, `.` — مثلاً `cloud-prod-ir`, `acme-onprem`.

**مشتری Cloud چند tenant:** برای هر tenant/دامنه جدا، `AppInstanceKey` جدا در appsettings همان deployment.

---

## 10. به‌روزرسانی سامانه و دیتابیس

در **اولین اجرا** پس از جایگزینی باینری:

1. اتصال SQL برقرار می‌شود
2. در صورت نبود DB → CREATE DATABASE
3. **`MigrateAsync`** — migrationهای EF Core اعمال می‌شوند
4. Seed در صورت نیاز

نیازی به `dotnet ef database update` دستی روی سرور مشتری نیست (مگر troubleshooting).

**شما هنگام release:**
- migration جدید در `src/Morobot.Infrastructure/Persistence/Migrations/` commit کنید
- در release note بنویسید «پس از آپدیت یک بار restart»

---

## 11. نسخه‌گذاری مستندات و kit

فایل مرجع: `docs/doc-versions.json`

| سند | وقتی عوض شد |
|-----|-------------|
| setup-guide.md | نسخه در سربرگ + doc-versions |
| vendor-ops-guide.md | همین |
| morobot-brochure.html | marketingBrochure |

ساخت zip kit برای کارمند جدید:

```powershell
.\tools\vendor-kit\BUILD-VENDOR-KIT.ps1 -Version 1.0.0
```

خروجی: `dist/morobot-vendor-kit-v1.0.0.zip`

---

## 12. بروشور بازاریابی (PDF)

1. باز کنید: `docs/marketing/morobot-brochure.html` در Chrome/Edge
2. Ctrl+P → **Save as PDF**
3. به مشتری احتمالی بدهید

محتوا: معرفی برند، **تاریخچه نسل‌های نرم‌افزار اتوماسیون مشابه** (نه جزئیات vendor)، امکانات، مزایا — اسکرین‌شات‌ها در `docs/marketing/screenshots/`.

---

## 13. عیب‌یابی رایج

| مشکل | اقدام |
|------|--------|
| لایسنس invalid | activation-request تازه؛ Anchor عوض نشده باشد |
| Sequence rollback | sequence جدید > قبلی |
| افزونه اشتباه به سرور | پنل همان دامنه را باز کنید؛ AppInstanceKey درست |
| دو Cloud روی یک PC | AppInstanceKey متفاوت + Load unpacked از دو مسیر |
| Migration fail | لاگ startup؛ دسترسی SQL؛ نسخه اپ با migration هماهنگ |

---

## تماس داخلی

مسائل کلید خصوصی، pricing، و SLA → مالک محصول / مدیریت.
