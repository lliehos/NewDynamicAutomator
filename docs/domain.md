# دامنه

هدف محصول (مرجع اصلی؛ مدل قدیمی V2 الزامی نیست):

کاربر یک **فرآیند** با **گروه، حلقه و شرط** می‌سازد و آن را اجرا می‌کند روی یکی از:

| `RepeatSourceType` | معنی |
|--------------------|------|
| `None` | یک‌بار |
| `DataSource` | به‌ازای هر ردیف منبع داده |
| `Elements` | به‌ازای هر المان صفحه (مثلاً ردیف جدول) — سلکتور روی گروه |
| `Loops` | تعداد ثابت تکرار |

## موجودیت‌ها

- `AutomationTask` فرآیند
- `Group` بلوک منطقی + حلقه (`ParentGroupId`, `MoveLoop`, `RepeatSourceType`, `Selector` برای Elements، `DataSourceId`)
- `Step` مرحله — **همیشه داخل یک گروه** (`GroupId`)
- `StepAction` اکشن + `OnFailedType`
- `ConditionGroup` / `Condition` — شاخه بین گروه‌ها (یال success/fail)
- `Selector` + `FramePathJson`
- `DataSource` / `DataSourceCell` — هر فرآیند چند منبع؛ بارگذاری از اکسل
- `UserTaskAccess`

## منابع داده (Excel)

- کاربر در ویرایشگر فرآیند یک یا چند فایل `.xlsx` بارگذاری می‌کند (`POST /Tasks/UploadDataSource/{taskId}` یا API معادل).
- ردیف اول شیت = هدر ستون‌ها → ستون‌ها به‌صورت **key/value** (`key` = نام هدر پایدار، `title` = نمایش).
- هر سلول داده به‌صورت **key / index / cellValue** ذخیره می‌شود (`index` = شماره ردیف داده از ۰، `key` = نام ستون).
- گروه با `RepeatSourceType = DataSource` و `DataSourceId` روی ردیف‌های منبع حلقه می‌زند؛ مراحل/شرایط می‌توانند به کلید ستون ارجاع دهند.

## سناریوی مرجع

رکورد → URL → شرط «فرم لاگین؟» → گروه لاگین یا منو → فرم → شرط «جدول ردیف دارد؟» → گروه حلقه `Elements` روی ردیف‌ها → تکرار بیرونی در صورت نیاز.

ضبط خطی مادهٔ خام است؛ شکستن به شرط/حلقه در ویرایشگر (علامت‌گذاری حین رکورد فاز بعد).

## اجرا

- `RunMode.Play`: پخش؛ الان خطی MVP؛ حلقه/شرط هوک دارند و کامل می‌شوند.
- `RunMode.Learn`: فاز ضروری ۵ — `onUnexpected` / `pauseForUser`.
