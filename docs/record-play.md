# رکورد و پخش

## رکورد — انجام شده

FAB پایین‌راست (فقط top-frame). بدون سشن پرتال قفل است.

رویداد: click / change / submit → CSS + `framePath` + URL + مقدار.  
پیش‌نویس: `chrome.storage.local`  
ذخیره: `POST /api/recordings` → بعد در `/Tasks/Editor/{id}` دیده می‌شود.

## پخش — فاز ۳ (انجام‌شدهٔ MVP)

موتور در افزونه:

1. `GET /api/tasks` و `GET /api/tasks/{id}/graph`
2. پیمایش خطی گروه‌های ریشه → استپ‌های `next` (شرط/حلقهٔ کامل بعداً)
3. `resolveFramePath` از top با `webNavigation` + `executeScript`
4. اجرای `Click` / `InputContent` / `GoToUrl` / `WaitTime` / … در فریم هدف
5. احراز هویت: خواندن کوکی `da_access` از پرتال و `Authorization: Bearer`

UI: FAB و popup — انتخاب فرآیند، پخش / توقف.

در `Play` واگرایی = `onUnexpected` → خطا و توقف.  
هوک `pauseForUser` برای فاز ۵ (Learn) رزرو است؛ منطق یادگیری نوشته نشده.
