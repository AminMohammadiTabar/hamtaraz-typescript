# یادداشت‌های مهاجرت Java → TypeScript

| Java v1.0.1 | TypeScript |
|---|---|
| Spring Boot / MVC | Node.js native HTTP server + Mustache |
| Apache POI | ExcelJS (وارد/صادر کردن XLSX) |
| `BigDecimal` whole rials | `bigint` immutable whole rials |
| `AggregateReconciler` | `src/domain/aggregate.ts` |
| `DefaultReconciliationEngine` | `src/domain/engine.ts` |
| `RuleBasedMatchingSession` | `src/domain/matching-session.ts` |
| `StandardStrategy`, `EnhancedStrategy` | انتخاب دو استراتژی در `src/domain/engine.ts` |
| `DefaultTransactionNormalizer` | `src/normalization/normalizer.ts` |
| `BankExcelParser`, `TbsExcelParser` | `src/infrastructure/excel/parser.ts` |
| `ExcelReportWriter` | `src/infrastructure/excel/report-writer.ts` |
| `ReconciliationService` | `src/application/reconciliation-service.ts` |
| `IdentityLookupPlanner` | `planIdentityLookups` |
| Spring Session | حافظه Session و cookie تصادفی، HttpOnly و SameSite |
| OpenFeign dynamic | پورت هویت و Adapter HTTPS native در کد (غیرعمومی در v1) |

## نکات همسان‌سازی

1. فاصله Integer و Floating Point: هیچ مبلغی به `number` تبدیل نمی‌شود، مگر در لحظه خواندن از سلول عددی Excel که باید عدد صحیح امن باشد.
2. `LocalDate` جاوا: تاریخ جلالی به ISO گرگوری تبدیل می‌شود، اما در جدول UI تاریخ اصلی Excel نمایش داده می‌شود.
3. فهرست اسناد دارای نام یا شناسه‌های پنهان در Source حفظ می‌شوند ولی در UI v1 قابل تنظیم نیستند.
4. وابستگی Feign مفهوم جاوایی دارد؛ در TypeScript از HTTPS Adapter معادل استفاده شده. این **ترجمه مستقیم کتابخانه Feign** نیست.
5. ساختار Mustache و CSS نسخه ۱ منتقل شده‌اند؛ فونت B Lotus در صورت داشتن مجوز، باید به‌صورت محلی اضافه شود.
6. در این بسته هیچ داده بانکی واقعی قرار داده نشده است.
7. این انتقال معادل‌سازی منطقی است، نه انتقال byte-for-byte و نه تضمین همسانی تمامی حالت‌های ناشناخته Excel بدون تست یکپارچه.
