# دامنه (Canvas-first)

منبع حقیقت هر فرآیند یک سند **Graph JSON** است (`Processes.GraphJson`). مدل رابطه‌ای گروه/مرحله/اکشن/شرط/سلکتور/منبع جدولی حذف شده است.

آرشیو اسکیمای ویندوزی V2 و جداول میانی برای مهاجرت بعدی: [legacy-windows-v2.md](legacy-windows-v2.md).

## هدف محصول

کاربر یک **فرآیند** با **گروه، حلقه و شرط** می‌سازد و با افزونه Chrome MV3 اجرا می‌کند.

| `repeatSourceType` (روی node گروه) | معنی |
|------------------------------------|------|
| `None` | یک‌بار |
| `DataSource` | به‌ازای هر ردیف منبع داخل همان Graph JSON |
| `Elements` | به‌ازای هر المان صفحه (سلکتور روی گروه) |
| `Loops` | تعداد ثابت تکرار |

## موجودیت‌های پایدار (DB)

- **`Process`** — عنوان، `GraphJson`, `DesignOrigin`, تأخیر پیش‌فرض، سازنده، زمان آخرین اجرا
- **`ProcessShare`** — ACL کاربر روی فرآیند (`CanView` / `CanEdit` / `CanDelete` / `CanExecute` / `CanChangeDataSource`)
- **`AppUser`**, **`Plan`**, **`PlanPrice`**, **`SystemSetting`**
- **`DeviceSession`**, **`AppEventLog`**

مفهوم‌های گروه/مرحله/شرط/سلکتور/منبع فقط داخل JSON هستند، نه ردیف جداگانه.

## Graph JSON

- `nodes[]`: `kind` ∈ `start` | `group` | `condition` | `step` | `action`
- `edges[]`: `kind` ∈ `next` | `contains` | `success` | `fail` | `parent`
- `dataSources[]`: منابع اکسل توکار (هدر = کلید ستون؛ ردیف‌ها key/value)
- `viewport`, `stepDelayMs`, `ignorePlayError`, … متادیتای ادیتور/پخش

سلکتور المان: `framePath[]` با `{ by, value, srcHint, indexInParent }` — بدون Selenium.

## ضبط

کلاینت: `recordingGroups[]` (Start → گروه خالی؛ اکشن‌ها داخل آخرین گروه؛ Pause/Start → گروه بعدی).

سرور: ذخیره فقط با merge به `GraphJson` (بدون جداول Groups/Steps).

## اجرا

- `RunMode.Play`: پخش روی تب هدف
- `RunMode.Learn`: فاز بعدی (پلن Gold)
