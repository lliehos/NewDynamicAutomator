# وضعیت پروژه — برای باز کردن این پوشه

مسیر: `C:\Projects\DynamicAutomatorV3`  
پوشهٔ قدیمی `dynamicAutomatorV2` را ببندید و همین را در Cursor باز کنید.

## الان چیست (قابل کار)

| بخش | وضعیت |
|-----|--------|
| سالوشن دات‌نت ۹ (Api / Web / Domain / Infrastructure / Contracts) | ساخته شده، build سبز |
| لاگین پرتال Vuexy RTL + JWT کوکی `da_access` | انجام |
| افزونه MV3 رکورد + زنجیره فریم | انجام |
| ویرایشگر **نمودار + فهرست** (`/Tasks/Editor/{id}`) | انجام: درگ، گروه، منبع تکرار، ذخیره گراف |
| مدل دامنه + مایگریشن EF (از جمله `CanvasJson`) | انجام |
| پخش قطعی در افزونه (گراف، فریم، Click/Input/GoToUrl) | انجام (MVP؛ حلقه/شرط کامل بعداً) |
| `RunMode` + `onUnexpected` / `pauseForUser` | هوک؛ Learn پیاده نشده |

کاربر توسعه: `admin` / `Admin123!`  
پرتال: `https://localhost:7201` — API: `https://localhost:7101`

```bash
dotnet run --project src/DynamicAutomator.Api
dotnet run --project src/DynamicAutomator.Web
```

افزونه: Chrome → Load unpacked → `extension/`  
پخش: FAB یا popup → انتخاب فرآیند → پخش روی تب فعال

## فازها

1. اسکلت + رکورد فریم‌آگاه — **انجام**
2. ویرایشگر بصری/فهرست + گروه‌بندی/تکرار — **انجام (CRUD منبع داده و اشتراک هنوز نه)**
3. پخش قطعی در افزونه — **انجام (MVP)**
4. اکشن‌های باقی‌مانده، shadow DOM، clone، حلقه/شرط کامل — بعدی
5. **Learn Mode — ضروری است، الان نه.** بعد از پایدار شدن پخش. سند: [learn-mode.md](learn-mode.md)

منطق Learn را پیاده نکنید؛ همان `onUnexpected` / `pauseForUser` را برای فاز ۵ نگه دارید.

## اسناد

- [architecture.md](architecture.md)
- [domain.md](domain.md)
- [frames.md](frames.md)
- [visual-editor.md](visual-editor.md)
- [record-play.md](record-play.md)
- [learn-mode.md](learn-mode.md)
