Morobot Vendor Kit
==================

1. docs/vendor-ops-guide.md را بخوانید (راهنمای کامل کارمند).
2. docs/visual-editor.md فهرست انواع اقدام و شرط ویرایشگر است (برای پرسش‌های مشتری).
3. docs/setup-guide.md راهنمای مشتری است — همراه بسته نصب تحویل داده می‌شود.
4. license-keys/morobot-private.pem را از مدیر امن دریافت کنید (یک بار genkeypair).
5. برای هر مشتری: sign لایسنس، سپس zip نصب (package) و در صورت نیاز zip آپدیت آفلاین
   (package-update) — هر دو در VendorStudio یا LicenseTool.
   پرچم‌های لایسنس: --allow-updates (پیش‌فرض روشن) و --allow-legacy-migration (پیش‌فرض خاموش).
6. BUILD-VENDOR-KIT.ps1 خروجی zip برای تحویل به تیم پشتیبانی می‌سازد.

نسخه kit: docs/doc-versions.json → vendorKit
