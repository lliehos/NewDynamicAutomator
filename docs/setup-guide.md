# راهنمای جامع راه‌اندازی Morobot

> **نسخه سند:** 1.6 · **آخرین به‌روزرسانی:** 2026-09-24  
> این راهنما برای مدیران فناوری اطلاعات و مسئول استقرار سازمان تهیه شده است.

---

## فهرست

1. [معرفی و لایسنس](#1-معرفی-و-لایسنس)
2. [محیط‌های پشتیبانی‌شده برای هاست وب](#2-محیطهای-پشتیبانیشده-برای-هاست-وب)
3. [پیش‌نیازها](#3-پیشنیازها)
4. [دریافت و محتوای بسته نصب](#4-دریافت-و-محتوای-بسته-نصب)
5. [پیکربندی دیتابیس](#5-پیکربندی-دیتابیس)
6. [اولین اجرا و ساخت خودکار دیتابیس](#6-اولین-اجرای-و-ساخت-خودکار-دیتابیس)
7. [استقرار روی سرور](#7-استقرار-روی-سرور)
8. [لایسنس](#8-لایسنس)
9. [دوره آزمایشی ۳ روزه](#9-دوره-آزمایشی-۳-روزه)
10. [حالت محدود پس از انقضا](#10-حالت-محدود-پس-از-انقضا)
11. [برندینگ سازمان](#11-برندینگ-سازمان)
12. [به‌روزرسانی نرم‌افزار](#12-بهروزرسانی-نرمافزار)
13. [کار با پنل و افزونه](#13-کار-با-پنل-و-افزونه)
14. [عیب‌یابی](#14-عیبیابی)

---

## 1. معرفی و لایسنس

Morobot یک سامانه اتوماسیون فرآیندهای وب است که روی SQL Server اجرا می‌شود و با افزونه مرورگر Chrome کار می‌کند.

**لایسنس:** روی **هر** نصب (SaaS، on-prem، محیط dev) اعمال می‌شود — ابتدا **دوره آزمایشی**، سپس لایسنس امضاشده از vendor. تغییر `Morobot:DeploymentMode` در `appsettings.json` لایسنس را **خاموش نمی‌کند**.

| برچسب `DeploymentMode` | کاربرد (اختیاری) |
|------------------------|------------------|
| **Cloud** | برچسب پیش‌فرض؛ تفاوتی در الزام لایسنس ندارد |
| **Enterprise** | برچسب سازمانی؛ تفاوتی در الزام لایسنس ندارد |

برای هر استقرار جدا (چند دامنه، چند سرور، dev) **`Morobot:AppInstanceKey`** یکتا تعریف کنید.

---

## 2. محیط‌های پشتیبانی‌شده برای هاست وب

Morobot یک برنامه **ASP.NET Core 9** است و روی سیستم‌عامل‌های مختلف قابل اجراست. **دیتابیس** باید **SQL Server** باشد (روی همان سرور یا سرور جدا — Windows، Linux یا سرویس ابری).

### جدول محیط‌های هاست

| محیط | پشتیبانی | روش پیشنهادی |
|------|----------|--------------|
| **Windows Server 2019+** | ✅ | IIS + Hosting Bundle، یا اجرای مستقیم برنامه |
| **Linux** (Ubuntu 22.04+, RHEL 8+, Debian 12+, …) | ✅ | برنامه + **nginx** (reverse proxy) + **systemd** |
| **Azure App Service** (Windows / Linux) | ✅ | استقرار بسته ASP.NET Core |
| **Docker / Kubernetes** | ✅ | کانتینر ASP.NET Core 9 + اتصال به SQL Server |
| **macOS** | ⚠️ فقط آزمایش | اجرای مستقیم — برای production توصیه نمی‌شود |

### نکات مهم

- **سیستم‌عامل سرور وب** مستقل از **سیستم‌عامل SQL Server** است — مثلاً برنامه روی **Linux** و دیتابیس روی **Windows** کاملاً ممکن است.
- **افزونه Chrome** روی **رایانه کاربر** نصب می‌شود؛ کاربران Windows، macOS یا Linux می‌توانند از Morobot استفاده کنند.
- بسته نصب پیش‌فرض ممکن است برای **Windows** (`Morobot.Web.exe`) یا **Linux** (`Morobot.Web.dll`) باشد — هنگام دریافت بسته، **پلتفرم مقصد** را به پشتیبانی اعلام کنید.
- برای **HTTPS** در production از گواهی معتبر (Let's Encrypt، گواهی سازمان، Azure/AWS) استفاده کنید.

---

## 3. پیش‌نیازها

### سرور وب

**Windows:**
- Windows Server 2019 یا جدیدتر
- [.NET 9 ASP.NET Core Runtime](https://dotnet.microsoft.com/download/dotnet/9.0) — برای IIS از **Hosting Bundle** استفاده کنید

**Linux:**
- توزیع پشتیبانی‌شده (Ubuntu 22.04 LTS، RHEL 8+، Debian 12+ و مشابه)
- [.NET 9 ASP.NET Core Runtime](https://dotnet.microsoft.com/download/dotnet/9.0) برای Linux
- **nginx** (یا Apache) به‌عنوان reverse proxy — توصیه می‌شود

### دیتابیس (الزامی — SQL Server)

- SQL Server 2019+، SQL Express، **SQL Server on Linux**، یا **Azure SQL**
- حساب اتصال باید اجازه **ساخت دیتابیس** را داشته باشد (در اولین اجرا)
- سرور SQL می‌تواند روی ماشین دیگری باشد

### کلاینت کاربران

- مرورگر Chrome یا Edge (Chromium)
- افزونه **Morobot Global** (+ Smart Recorder اختیاری) — یک بار Load unpacked

### شبکه

- **HTTPS** با گواهی معتبر (توصیه می‌شود)
- برای بررسی به‌روزرسانی: دسترسی به اینترنت یا URL سفارشی که در لایسنس یا تنظیمات تعریف شده

---

## 4. دریافت و محتوای بسته نصب

بسته نصب Enterprise معمولاً به‌صورت فایل فشرده (`morobot-server.zip`) در اختیار سازمان قرار می‌گیرد.

پس از استخراج، ساختار کلی به این شکل است:

**Windows:**
```
morobot-server/
├── Morobot.Web.exe          ← برنامه اصلی
├── appsettings.json
├── docs/setup-guide.md
├── wwwroot/
└── ...
```

**Linux:**
```
morobot-server/
├── Morobot.Web.dll          ← برنامه اصلی
├── appsettings.json
├── docs/setup-guide.md
├── wwwroot/
└── ...
```

**مرحله بعد:** پوشه را روی سرور مقصد کپی کنید (مثلاً `C:\Apps\Morobot` در Windows یا `/opt/morobot` در Linux).

---

## 5. پیکربندی دیتابیس

Morobot از **SQL Server** به‌عنوان موتور دیتابیس استفاده می‌کند. **سرور، نام دیتابیس، کاربر و رمز** همگی در زمان نصب از طریق `appsettings.json` (یا متغیر محیطی `ConnectionStrings__Default`) مشخص می‌شوند — نیازی به تنظیم جدا در کد نیست.

> **PostgreSQL / MySQL:** در نسخه فعلی پشتیبانی نمی‌شود. فقط SQL Server (Windows، Linux یا Azure SQL).

### 5.1 تنظیم اتصال در appsettings.json

قبل از اولین اجرا، بخش `ConnectionStrings:Default` را مطابق SQL Server سازمان ویرایش کنید:

```json
"ConnectionStrings": {
  "Default": "Server=SQLHOST\\INSTANCE;Database=MorobotV3;User Id=morobot;Password=***;TrustServerCertificate=True;MultipleActiveResultSets=true"
}
```

### 5.2 اتصال دیتابیس داخل لایسنس (Enterprise)

در برخی قراردادها، اطلاعات اتصال دیتابیس داخل فایل لایسنس قرار داده می‌شود. پس از وارد کردن لایسنس:

- تنظیمات اتصال در سامانه ذخیره می‌شود
- برای اعمال تغییر، **یک بار سرویس را راه‌اندازی مجدد** کنید
- در پنل مدیریت فقط **نام سرور** نمایش داده می‌شود (رمز عبور نمایش داده نمی‌شود)

---

## 6. اولین اجرا و ساخت خودکار دیتابیس

در اولین اجرا، Morobot به‌صورت خودکار این کارها را انجام می‌دهد:

1. اگر دیتابیس روی SQL Server وجود نداشته باشد → **ایجاد دیتابیس**
2. **ساخت و به‌روزرسانی جداول** مورد نیاز
3. **تنظیمات اولیه** و حساب مدیر (در صورت تعریف در بسته نصب)

### راه‌اندازی برنامه

**Windows:**
```powershell
cd C:\Apps\Morobot
.\Morobot.Web.exe
```

**Linux:**
```bash
cd /opt/morobot
dotnet Morobot.Web.dll
```

برای تعیین آدرس و پورت:

**Windows:**
```powershell
$env:ASPNETCORE_URLS = "http://0.0.0.0:5000"
.\Morobot.Web.exe
```

**Linux:**
```bash
export ASPNETCORE_URLS="http://127.0.0.1:5000"
dotnet Morobot.Web.dll
```

> در production معمولاً برنامه پشت reverse proxy (IIS یا nginx) با HTTPS اجرا می‌شود — بخش ۷.

### آدرس‌های مهم

| مسیر | توضیح |
|------|--------|
| `/` | صفحه معرفی |
| `/Home/SetupGuide` | همین راهنما (نسخه وب) |
| `/Panel` | پنل کاربر |
| `/Admin` | پنل مدیر (نقش Admin) |

---

## 7. استقرار روی سرور

### 7.1 Windows — IIS (پیشنهادی برای سازمان‌های Windows)

1. نصب **ASP.NET Core Hosting Bundle 9**
2. ایجاد **Application Pool** با گزینه **No Managed Code**
3. ایجاد **Site** — مسیر فیزیکی = پوشه نصب Morobot
4. تنظیم **Binding** با HTTPS
5. فایل `web.config` همراه بسته نصب است

### 7.2 Windows — اجرای مستقیم

مناسب برای محیط آزمایشی یا سرورهای کوچک. برنامه را با `Morobot.Web.exe` اجرا کنید. برای اجرای دائم می‌توانید از **Windows Service** (مثلاً با NSSM) استفاده کنید.

### 7.3 Linux — nginx + systemd (پیشنهادی)

**۱. سرویس systemd** (فایل `/etc/systemd/system/morobot.service`):

```ini
[Unit]
Description=Morobot Web
After=network.target

[Service]
WorkingDirectory=/opt/morobot
ExecStart=/usr/bin/dotnet /opt/morobot/Morobot.Web.dll
Restart=always
RestartSec=10
Environment=ASPNETCORE_URLS=http://127.0.0.1:5000
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable morobot
sudo systemctl start morobot
```

**۲. nginx** (نمونه `/etc/nginx/sites-available/morobot`):

```nginx
server {
    listen 443 ssl;
    server_name morobot.example.com;

    ssl_certificate     /etc/ssl/certs/morobot.crt;
    ssl_certificate_key /etc/ssl/private/morobot.key;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**۳. SignalR:** اگر از قابلیت‌های real-time استفاده می‌کنید، در nginx هدرهای `Upgrade` و `Connection` باید فعال باشند (در نمونه بالا هست).

### 7.4 Docker / Kubernetes

- تصویر پایه: `mcr.microsoft.com/dotnet/aspnet:9.0`
- متغیر `ConnectionStrings__Default` را در environment تنظیم کنید
- SQL Server باید از داخل کانتینر در دسترس باشد
- برای HTTPS از ingress یا load balancer استفاده کنید

### 7.5 Azure App Service

- Runtime stack: **.NET 9**
- Connection string را در **Configuration → Connection strings** تنظیم کنید
- برای Linux plan همان بسته `Morobot.Web.dll` را deploy کنید

### 7.6 پشت Reverse Proxy (عمومی)

چه IIS ARR، چه nginx، چه load balancer — هدرهای **`X-Forwarded-Proto`** و **`X-Forwarded-For`** را فعال کنید تا HTTPS و IP کلاینت درست تشخیص داده شود.

---

## 8. لایسنس

همه نصب‌ها (شامل Cloud و dev) از **Admin → License** درخواست فعال‌سازی و import لایسنس دارند.

### 8.1 مراحل فعال‌سازی

```
نصب → دوره آزمایشی (در صورت فعال بودن) → Admin/License → دریافت فایل activation-request
     → ارسال به پشتیبانی/فروشنده → دریافت license.morobot → Import در Admin/License
```

### 8.2 وارد کردن لایسنس

1. ورود به `/Admin/License`
2. بارگذاری فایل `.morobot` یا وارد کردن محتوای JSON
3. **داده‌های موجود (کاربر، فرآیند، منبع) حذف نمی‌شوند** — فقط اطلاعات لایسنس به‌روز می‌شود؛ import موفق همه ردیف‌ها را به «نمونه نصب» فعلی وصل می‌کند؛ import موفق همه ردیف‌ها را به «نمونه نصب» فعلی وصل می‌کند
4. برای ارتقا (مثلاً افزایش سقف کاربر): فایل لایسنس جدید با شماره نسخه بالاتر دریافت کنید

### 8.3 اطلاعات قابل مشاهده در پنل مدیریت

- نام سازمان، تاریخ اعتبار، سقف کاربر، شماره نسخه لایسنس
- نام سرور دیتابیس (بدون رمز)، وضعیت به‌روزرسانی
- **دامنه / IP مجاز** (در صورت تعریف در لایسنس؛ خالی = بدون قفل آدرس)
- **نمایش داده نمی‌شود:** امضای دیجیتال، رشته اتصال کامل، کلیدها

### 8.4 نشان کپی‌رایت

در حالت **آزمایشی** یا **محدود** (بدون لایسنس معتبر)، نوار کپی‌رایت در کل برنامه نمایش داده می‌شود. با لایسنس معتبر و برندینگ سفارشی، این نشان برداشته می‌شود.

---

## 9. دوره آزمایشی ۳ روزه

- از **اولین اجرا روی همان سرور** شروع می‌شود (اثر انگشت سخت‌افزار/OS سرور، نه مرورگر کاربر)
- یک ردیف ثابت در جدول `DeploymentTrialRecords` نگه می‌دارد؛ **حذف ردیف anchor در دیتابیس دوره آزمایشی را از نو نمی‌دهد**
- **۳ روز** بدون لایسنس: همه قابلیت‌ها فعال + نشان کپی‌رایت
- مدت دوره آزمایشی ممکن است در لایسنس سازمان متفاوت باشد (پیش‌فرض: ۳ روز)
- درخواست فعال‌سازی (`activation-request.json`) شامل `ServerFingerprintHash` است تا فروشنده بتواند نصب را تشخیص دهد
- اگر entitlement آزمایشی از نو ساخته شود (`DeploymentTrialRecords` جدید)، کاربران و فرآیندهای قدیمی (InstanceId متفاوت) بدون لایسنس قابل استفاده نیستند
- اگر entitlement آزمایشی از نو ساخته شود (`DeploymentTrialRecords` جدید)، کاربران و فرآیندهای قدیمی (InstanceId متفاوت) بدون لایسنس قابل استفاده نیستند

---

## 10. حالت محدود پس از انقضا

پس از پایان دوره آزمایشی یا انقضای لایسنس:

| مجاز | غیرمجاز |
|------|---------|
| ورود / خروج | ویرایشگر، اجرا، ضبط |
| مشاهده لیست فرآیندها | ایجاد فرآیند یا منبع جدید |
| مشاهده نمودار فرآیند (فقط خواندنی) | اکثر بخش‌های پنل مدیریت |

برای رفع محدودیت: لایسنس معتبر را در `/Admin/License` وارد کنید.

---

## 11. برندینگ سازمان

**فقط با لایسنس معتبر:** از مسیر `/Admin/Branding`

- نام برنامه، عنوان برند، نام سازمان
- آپلود لوگو و آیکون (favicon)

---

## 12. به‌روزرسانی نرم‌افزار

- امکان بررسی به‌روزرسانی بسته به تنظیمات لایسنس
- آدرس پیش‌فرض بررسی: `https://morobot.ir/checkupdate`
- **قرارداد API (GET):** `?current={نسخه_نصب}` → JSON:

```json
{
  "version": "3.0.0",
  "notes": "یادداشت انتشار",
  "downloadUrl": "https://morobot.ir/download",
  "updateAvailable": true,
  "current": "2.9.0",
  "publishedUtc": "2026-09-24T00:00:00Z"
}
```

فیلدهای `version`، `notes` و `downloadUrl` برای سازگاری با نصب‌های قدیمی کافی است. روی سرور محصول (`morobot.ir`) یا در dev: `GET https://localhost:7201/checkupdate?current=2.0.0`

- **API ادمین (نیاز به نقش Admin):** `GET /api/updates/status` — وضعیت کش‌شده؛ `POST /api/updates/check` — بررسی آنلاین و به‌روزرسانی کش
- مدیر می‌تواند آدرس را در **Settings → Updates** تغییر دهد
- **بررسی دستی:** Admin/License → «بررسی آپدیت»
- **سرور بدون اینترنت:** آخرین نتیجه ذخیره‌شده نمایش داده می‌شود؛ سامانه هر ۶ ساعت یک‌بار تلاش می‌کند

> اعمال به‌روزرسانی (جایگزینی فایل‌های برنامه) فعلاً دستی است: دریافت بسته جدید از پشتیبانی، پشتیبان‌گیری، استخراج، راه‌اندازی مجدد.

**دیتابیس:** در **اولین اجرا بعد از آپدیت**، Morobot خودکار migrationهای EF Core را روی SQL Server اعمال می‌کند — نیازی به دستور جدا نیست (فقط سرویس را restart کنید).

---

## 13. کار با پنل و افزونه

### 13.1 افزونه Morobot Global (ضبط + اجرا + سلکتور)

**یک افزونه** به نام **Morobot Global** (`extension-global`) جایگزین سه افزونه جداگانه Recorder/Player/Selector شده است.

| افزونه | کاربرد |
|--------|--------|
| **Morobot Global** | ضبط، اجرا (Play) و کپی سلکتور |
| **Smart Recorder** | هوشمندسازی — **جدا** و اختیاری |

- **Cloud و Enterprise:** همان Morobot Global — آدرس سرور از پنلی که باز می‌کنید گرفته می‌شود
- **آیکون:** از برند Morobot (در Enterprise با برندینگ سفارشی، vendor می‌تواند آیکون‌ها را در بسته جایگزین کند)
- افزونه‌های قدیمی Recorder/Player/Selector را **حذف** کنید و فقط Global + Smart (در صورت نیاز) نصب کنید

### 13.2 جریان کار پیشنهادی

1. وارد **پنل همان سروری** شوید که می‌خواهید با آن کار کنید (Cloud یا سازمانی)
2. از `/Panel/Extension/Install` افزونه‌ها را نصب کنید (یا از Chrome Web Store در Cloud)
3. **یک بار** وارد پنل شوید تا افزونه آدرس سرور را بگیرد
4. سپس فرآیند بسازید، Excel وصل کنید و Play/Record بزنید

> **قبل از ضبط یا اجرا** حتماً پنل سرور موردنظر را باز کنید تا افزونه به همان سرور متصل شود.

### 13.3 استفاده همزمان از Cloud و Enterprise

افزونه در هر لحظه **یک سرور فعال** دارد — معمولاً **آخرین پنلی** که باز کرده‌اید.

| سناریو | راه‌حل |
|--------|--------|
| فقط Cloud **یا** فقط Enterprise | همان یک مجموعه افزونه کافی است |
| **همزمان** چند Cloud / Enterprise روی یک مرورگر | **`AppInstanceKey` متفاوت** در هر deployment + Load unpacked از مسیر جدا (پنل Extension/Install) |
| **همزمان** با یک پروفایل و تداخل storage | **پروفایل جداگانه Chrome** (توصیه) |

اگر واقعاً به دو سرور **همزمان** در **یک پروفایل** نیاز دارید، از پشتیبانی بخواهید بسته افزونه با **شناسه جدا** (Extension ID متفاوت) تهیه شود تا هر دو کنار هم نصب شوند — این حالت استثنایی است.

### 13.4 نصب افزونه

**Cloud:** از پنل یا فروشگاه Chrome (در صورت انتشار رسمی)

**Enterprise (on-prem):**
1. ورود از `/Panel/Account/Login`
2. رفتن به `/Panel/Extension/Install`
3. Load unpacked از مسیر نمایش‌داده‌شده (یا دانلود zip هر افزونه)

### 13.5 نکات مهم

- افزونه روی **رایانه کاربر** نصب می‌شود، نه روی سرور
- سرور وب می‌تواند Windows یا Linux باشد — برای افزونه فرقی نمی‌کند
- کاربران می‌توانند Windows، macOS یا Linux داشته باشند — فقط Chrome/Edge لازم است
- اگر افزونه به سرور اشتباه وصل شد: پنل سرور درست را باز کنید، صفحه را refresh کنید، دوباره Record/Play بزنید

### 13.6 AppInstanceKey (مسیر افزونه)

در `appsettings.json`:

```json
"Morobot": {
  "AppInstanceKey": "cloud-prod-ir"
}
```

مسیر پوشه افزونه روی ماشین (همگام‌سازی dev/local):

`%LOCALAPPDATA%\morobot.soras.ir\{AppInstanceKey}\extension-global`

هر Morobot با **دامنه + AppInstanceKey** یکتا باشد تا روی یک PC تداخل نداشته باشد.

---

## 14. عیب‌یابی

| مشکل | راه‌حل |
|------|--------|
| خطای اتصال SQL | بررسی connection string، فایروال SQL Server، گزینه TrustServerCertificate |
| خطا در ساخت دیتابیس | بررسی لاگ راه‌اندازی؛ اطمینان از دسترسی CREATE DATABASE |
| «لایسنس معتبر نیست» | درخواست activation-request جدید از Admin/License و دریافت لایسنس تازه |
| لایسنس قدیمی‌تر قبول نمی‌شود | لایسنس جدید باید شماره نسخه بالاتر داشته باشد |
| سقف کاربر | دریافت لایسنس با سقف کاربر بالاتر |
| تغییر اتصال دیتابیس بعد از لایسنس | appsettings.json را هماهنگ کنید و سرویس را restart کنید |
| برنامه روی Linux بالا نمی‌آید | نصب ASP.NET Core 9 Runtime برای Linux؛ مسیر `dotnet` در systemd |
| 502 از nginx | بررسی `systemctl status morobot`؛ پورت `ASPNETCORE_URLS` با `proxy_pass` یکی باشد |
| افزونه به سرور اشتباه وصل است | پنل سرور درست را باز کنید؛ refresh؛ دوباره Record/Play |
| افزونه روی دامنه سازمانی کار نمی‌کند | یک بار `/Panel` را روی همان دامنه باز کنید تا آدرس سرور ثبت شود |

---

## تماس با پشتیبانی

برای دریافت لایسنس، بسته به‌روزرسانی یا پشتیبانی استقرار با **پشتیبانی Morobot / فروشنده** تماس بگیرید.
