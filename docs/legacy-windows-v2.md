# آرشیو: نرم‌افزار ویندوزی V2 و اسکیمای رابطه‌ای میانی

این سند برای مهاجرت آیندهٔ داده از اپ ویندوزی/`dynamicAutomatorV2` و برای فهم جداول رابطه‌ای‌ای است که در پاکسازی Canvas-first از `MorobotV3` حذف شدند. **منبع حقیقت محصول فعلی این جداول نیست** — گراف فرآیند داخل `Processes.GraphJson` است.

## مرجع ویندوزی

| مورد | مقدار |
|------|--------|
| مسیر مرجع | `C:\Projects\dynamicAutomatorV2` (به‌ویژه `FormRecord`) |
| اجرا | Selenium + UI دسکتاپ |
| ذخیره | SQL رابطه‌ای (گروه / مرحله / اکشن / شرط / سلکتور / منبع اکسل) |

منطق ضبط V2 (برای اسکریپت مهاجرت):

1. **Start** → یک **Group خالی** روی Task جاری
2. رویدادهای مرورگر → **Step** داخل **آخرین Group**
3. Pause سپس Start دوباره → Group خالی بعدی
4. ذخیره → درخت Groups (+ Steps توکار) persist می‌شود

V3 همان معنا را در کلاینت با `recordingGroups[]` نگه می‌دارد؛ persist سرور فقط Graph JSON است.

## نگاشت مفهومی V2 / جداول میانی → Graph JSON

| مفهوم ویندوز / جدول میانی | در Graph JSON فعلی |
|---------------------------|---------------------|
| Task / AutomationTask | سند ریشه: `title`, `viewport`, `nodes`, `edges`, `dataSources`, `stepDelayMs`, … |
| Group (+ حلقه `RepeatSourceType`, `DataSourceId`, `Selector`) | node با `kind: "group"` (+ فیلدهای حلقه روی node) |
| Step + StepAction | node با `kind: "step"` یا `"action"` (ویرایشگر هر دو را می‌پذیرد) |
| ConditionGroup (+ یال success/fail) | node با `kind: "condition"`؛ edges با `kind: "success"` / `"fail"` |
| Condition (ردیف‌های predicate) | داخل payload همان condition node (جدول `Conditions` در میانی عملاً بدون writer بود) |
| Selector + FramePathJson | روی node اکشن/گروه: `framePath[]` با `{ by, value, srcHint, indexInParent }` |
| DataSource + DataSourceCell | آرایهٔ توکار `dataSources[]` (عنوان، ستون‌ها، ردیف‌ها) |
| UserTaskAccess | جدول `ProcessShares` (ACL جدا از گراف) |

شکل تقریبی سند (camelCase):

```json
{
  "taskId": 1,
  "title": "...",
  "viewport": { "x": 40, "y": 40, "zoom": 1 },
  "nodes": [{ "id": "start-1", "kind": "start", "x": 0, "y": 0 }],
  "edges": [{ "id": "e1", "from": "start-1", "to": "g1", "kind": "next" }],
  "dataSources": [{ "id": "ds-local-1", "title": "Sheet", "columns": [], "rows": [] }]
}
```

یال‌های رایج: `next`, `contains`, `success`, `fail`, `parent`.

## جداول رابطه‌ای میانی که DROP شدند (MorobotV3 پیش از Canvas-first)

این‌ها پل موقت بین V2 و ادیتور وب بودند و دیگر در مدل دامنه نیستند:

- `Groups`, `Steps`, `Actions`, `ConditionGroups`, `Conditions`
- `Selectors`
- `DataSources`, `DataSourceCells`, `TaskDataSources`
- فیلدهای بلااستفاده روی Task: `CopyFromId`, `UseGlobalDataSources`
- ستون تکراری share: `CanModify` (معادل `CanEdit`)

قبل از DROP، یک backfill یک‌بارمصرف گراف رابطه‌ای را داخل `CanvasJson`/`GraphJson` ریخت اگر سند خالی/ناقص بود.

## جداول نگهداشتی پس از پاکسازی

| جدول | نقش |
|------|-----|
| `Users`, `Plans`, `PlanPrices`, `SystemSettings` | هویت و پلن |
| `Processes` (قبلاً `Tasks`) | فرآیند + `GraphJson` |
| `ProcessShares` (قبلاً `UserTasks`) | اشتراک و ACL |
| `DeviceSessions`, `EventLogs` | دستگاه و لاگ |

نام‌های HTTP قدیمی (`/api/tasks`, …) برای سازگاری کلاینت/افزونه حفظ شده‌اند؛ entity دامنه `Process` است.

## نکات اسکریپت مهاجرت آینده از V2

1. درخت Group/Step/Condition ویندوزی را به `nodes`/`edges` تبدیل کن (همان منطق قدیمی `GraphService.Get` مرجع خوبی است اگر از git تاریخچه خوانده شود).
2. سلول‌های اکسل را به `dataSources[]` توکار ببر؛ به جدول جداگانه نیاز نیست.
3. `framePath` را عیناً از سلکتور Selenium/V2 نگه دار.
4. ACL کاربران را جدا از گراف در `ProcessShares` بنویس.
5. پس از import، فقط `GraphJson` را منبع حقیقت بدان؛ dual-write نکن.

## عمداً خارج از این سند

پیاده‌سازی اسکریپت import واقعی از DB ویندوزی — فقط نگاشت و قرارداد بالا.
