# رکورد و پخش

## نصب افزونه (اولین ورود)

پرتال اگر handshake افزونه را نبیند مودال اجباری نشان می‌دهد:

1. دانلود ZIP از `/extension/download`
2. Load unpacked در `chrome://extensions` یا `edge://extensions`
3. «بررسی مجدد»

فقط Chrome / Edge (Chromium). نصب بی‌صدا از وب‌اپ ممکن نیست.

## رکورد

- دکمه **شروع ضبط** در صفحه فرآیندها (نیاز به افزونه)
- یا FAB قرمز **REC** / popup → `startRecordSession`
- تب راهنما: `https://localhost:7201/Record`
- ذخیره → گروه خطی استپ‌ها؛ شکستن به شرط/حلقه در ویرایشگر

## پخش

موتور در افزونه گراف را خطی اجرا می‌کند (MVP). هوک‌های `RepeatSourceType` و یال شرط برای فاز بعد رزرو شده‌اند.

در Play واگرایی = `onUnexpected` → توقف. Learn = فاز ۵.
