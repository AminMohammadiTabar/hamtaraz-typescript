# برنامه تست و وضعیت راستی‌آزمایی

## اجرا

```sh
npm install
npm test
npm run typecheck
npm run build
```

برای Golden Test اصل فایل‌ها، متغیرهای `GOLDEN_BANK` و `GOLDEN_TBS` را به مسیر فایل‌ها بدهید؛ فایل‌های بانکی در مخزن قرار نمی‌گیرند.

## تست اجراشده در این محیط

- ۳۳ تست مستقل از پکیج‌های npm، با اجرای واقعی Node.js 22 و TypeScript: موفق، صفر شکست.
- ۳ تست Integration (XLSX واقعی مصنوعی، جریان HTTP، Golden File): نوشته‌شده اما به دلیل در دسترس نبودن کتابخانه‌های npm، به‌طور صریح Skip شده‌اند.
- `tsc --noEmit`: با انواع Node در محیط ابزار اجرا شد و موفق بود (بعد از رفع importهای اختیاری).
- داده‌های واقعی بانک و TBS با Python/OpenPyXL از XLSX استخراج و در یک مسیر موقت خارج از بسته، وارد Normalizer و Matching Engine TypeScript شدند. نتیجه Enhanced: ۱۵٬۲۷۸ جفت، سه ردیف ۵۴۶۴، ۱۰۱۲۵، ۱۰۴۰۳، صفر نامشخص؛ مجموع ۲۴٬۱۹۹٬۹۰۰ ریال. Standard: ۵٬۵۷۸ جفت و ۱۹٬۴۰۳ مورد نامشخص.

**مهم:** این سناریوی Golden مسیر *ExcelJS از خود XLSX* را آزمایش نکرد؛ برای تأیید رسمی End-to-End باید Golden Integration Test پس از npm install اجرا شود.

## نکات پذیرش قبل از انتشار عملیاتی

- `npm test` شامل ۳ تست Integration بدون Skip.
- `npm run build` و اجرای HTTP از `dist/src/server.js`.
- آزمون XLSX واقعی روی گزارش روزهای دیگر و قالب‌های مختلف Excel.
- آزمون اندازه فایل، نرخ درخواست، تداخل نشست‌ها، خاموشی سرویس، پایداری امنیتی و بازبینی محرمانگی اطلاعات.
