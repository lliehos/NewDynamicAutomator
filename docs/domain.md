# دامنه (Canvas-first + کتابخانه منابع)

منبع حقیقت **گراف فرآیند** سند **Graph JSON** است (`Processes.GraphJson`). گروه/مرحله/شرط/سلکتور داخل JSON هستند.

**منابع داده (Excel)** موجودیت مستقل در جدول `DataSources` هستند و با جدول واسط `ProcessDataSources` به فرآیند وصل می‌شوند. حذف فرآیند فقط لینک را پاک می‌کند؛ کتابخانه می‌ماند. جدا کردن منبع از فرآیند ≠ حذف از کتابخانه.

آرشیو اسکیمای ویندوزی V2: [legacy-windows-v2.md](legacy-windows-v2.md).

## هدف محصول

کاربر یک **فرآیند** با **گروه، حلقه و شرط** می‌سازد و با افزونه Chrome MV3 اجرا می‌کند.

| `repeatSourceType` (روی node گروه) | معنی |
|------------------------------------|------|
| `None` | یک‌بار |
| `DataSource` | به‌ازای هر ردیف منبع لینک‌شده |
| `Elements` | به‌ازای هر المان صفحه (سلکتور روی گروه) |
| `Loops` | تعداد ثابت تکرار |

## موجودیت‌های پایدار (DB)

- **`Process`** — عنوان، `GraphJson`, `DesignOrigin`, تأخیر، سازنده
- **`ProcessShare`** — ACL (`CanView` / `CanEdit` / `CanDelete` / `CanExecute` / `CanChangeDataSource`)
- **`DataSource`** — کتابخانهٔ کاربر (Title، ColumnsJson، CellsJson، مالک)
- **`ProcessDataSource`** — لینک فرآیند↔منبع (`IsDefault`, `SortOrder`)؛ cascade با حذف فرآیند؛ Restrict روی منبع
- **`AppUser`**, **`Plan`** (`MaxTasks`, `MaxDataSources`, `MaxProcessSteps`), **`PlanPrice`**, **`SystemSetting`**
- **`DeviceSession`**, **`AppEventLog`**

## Graph JSON

- `nodes[]` / `edges[]` — گراف ادیتور/پخش
- `dataSources[]` — اسنپ‌شات هیدراته‌شده از کتابخانه برای ادیتور/افزونه (SoT کتابخانه است)
- نام ستون سلکتور (`selectorDynamicColumn` و …) با جدا شدن منبع حفظ می‌شود؛ با تغییر منبع پیش‌فرض می‌توان سلکتورهای با ستون متناظر را یکجا به‌روز کرد

## انتقال از دیتابیس قدیمی (ادمین)

فقط فرآیندهایی که کاربر **مالک** آن‌هاست (`CreatorUserId`) با گروه/مرحله/شرط به مبدأ `Transferred` منتقل می‌شوند. **منابع منتقل نمی‌شوند.**

## ضبط / اجرا

همان Graph JSON؛ ضبط merge به بوم؛ پخش روی تب هدف.
