# دامنه

سلسله مثل V2 با نام‌های درست:

- `AutomationTask` فرآیند
- `Group` گروه + حلقه (`ParentGroupId`, `MoveLoop`, `RepeatSourceType`)
- `Step` مرحله (`IsConditional`)
- `StepAction` اکشن + `OnFailedType` واقعی
- `ConditionGroup` / `Condition` (AND همه غیر-OR؛ اگر OR باشد حداقل یکی)
- `Selector` + `FramePathJson` آرایه فریم از top به پایین
- `DataSource` ستون‌ها JSON + `DataSourceCell`
- `UserTaskAccess` اشتراک (`CanModify` یا سازنده)

منطق اجرا (فاز ۳، هنوز در افزونه کامل نیست): حلقه گروه، گیت شرطی در مقابل شاخه+ادامه، تأخیر قبل/بعد. `RunMode.Play` الان؛ `RunMode.Learn` فاز ضروری ۵.
