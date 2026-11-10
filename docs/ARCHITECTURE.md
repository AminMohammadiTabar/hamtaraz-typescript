# معماری فنی هم‌تراز — TypeScript Edition

## ۱. معماری کلان

معادل Modular Monolith و الگوی Ports & Adapters نسخه Java حفظ شده؛ تنها Runtime و وابستگی‌های مرزی تغییر کرده‌اند:

```text
Browser RTL (Mustache + CSS + JS)
    |   GET / | POST /reconcile | GET /results | GET /results/download
    v
Node HTTP Adapter [src/web/server.ts]
    | upload buffers / session-aware result
    v
Application: ReconciliationService
    | parse XLSX, normalize, verify, reconcile, plan optional identity lookups
    +------> Infrastructure: Excel Parser/Writer (ExcelJS)
    +------> Normalization: Normalizer (source-specific regular expressions)
    v
Domain Engine
    |-- Aggregate gate: counts & bigint totals
    |-- STANDARD: explicit Mofid-issued transaction ID vs bank external ID
    |-- ENHANCED: categorized rule chain (reference suffix, transfer, reversal, exceptional tracking)
    |-- MatchingSession: one-use rows, duplicate groups, last-resort identity
    v
ReconciliationResult -> UI / XLSX

IdentityInquiryPort (Domain Port)
    ^
    | future approval-only HTTP adapter (src/infrastructure/identity)
```

## ۲. Domain

- `models.ts`: قراردادهای `Transaction`, `ReconciliationResult`, `Discrepancy` و مقادیر ثابت انواع.
- `aggregate.ts`: تطبیق تجمیعی با مجموع ریالی `bigint`، کنترل یکتایی فیزیکی `source/sheet/row`.
- `matching-session.ts`: مجموعه ردیف‌های مصرف‌شده و مبهم، گروه‌بندی بر اساس شناسه و مبلغ، تطبیق یک‌به‌یک یا گروهی و طبقه‌بندی بدون حدس.
- `engine.ts`: Strategy Pattern. مسئولیت انتخاب Standard/Enhanced و ترتیب قواعد.

ساختار `Transaction` عمداً دو شناسه ۱۹ رقمی مستقل دارد: `mofidTransactionId` (صادرشده در سامانه مفید و استخراج‌شده از شرح TBS) و `bankExternalTransactionId` (مقدار خوانده‌شده از بانک که بدون شواهد مستقل هم‌معنا فرض نمی‌شود).

## ۳. Normalization

`normalizer.ts` مستقل از ExcelJS است و یک `RawExcelRow` به یک Transaction تبدیل می‌کند. شناسه `MC` ممکن است در هرکدام از دو ستون توضیحات و توضیحات اضافی باشد. نرمال‌ساز با صفرگذاری چپ، شناسه ملی ۸ تا ۱۰ رقمی را برای مقایسه به ۱۰ رقم تبدیل می‌کند، بدون تغییر مقادیر خام؛ فرمت مبلغ علمی (مانند `1.0E+6`) به ریال صحیح تبدیل می‌شود. TBS نوع سند و شناسه ۱۹ رقمی برچسب‌دار را به‌صورت مستقل استخراج می‌کند. تاریخ خورشیدی به Gregorian ISO تبدیل می‌شود، مشابه Java `LocalDate`.

## ۴. Excel Infrastructure

`parser.ts`: پیدا کردن هدر در ۴۰ ردیف اول، تشخیص Sheet یکتا، حفظ شماره ردیف واقعی، اعتبارسنجی مبلغ صحیح، حذف برداشت‌ها و ردیف‌های مانده و جمع کل، گزارش دقیق علت استثنا. فرمول‌ها و خطاهای Excel پذیرفته نمی‌شوند. ورودی مالی از سلول عددی فراتر از محدوده دقت صحیح JavaScript با خطا متوقف می‌شود؛ نباید شناسه‌های بلند ذخیره‌شده به‌صورت Numeric را حدس زد.

`report-writer.ts`: Sheetهای `Summary`, `Bank Only`, `TBS Only`, `Unresolved`. تمامی سلول‌های داده از نوع رشته هستند؛ پیشوندهای بالقوه فرمولی خنثی می‌شوند.

## ۵. Application

`ReconciliationService.prepare`: ابتدا Parserها، سپس نرمال‌ساز؛ تعداد و جمع حاصل با گزارش Parser مقایسه می‌شود؛ سپس موتور اجرا شده و فهرست کد ملی‌های یکتای واقعاً نیازمند استعلام برآورد می‌شود. `finishWithIdentity` کدی برای فاز دوم اختیاری است، اما Endpoints آن در v1 عمومی فعال نیستند.

## ۶. Web

Node.js HTTP بدون وابستگی Express، Mustache با فایل‌های قالب نسخه ۱، HTML راست‌به‌چپ، CSS اختصاصی و TypeScript سمت مرورگر (`src/web/client/app.ts`) که هنگام Build به JavaScript تبدیل می‌شود. فرم دارای CSRF token در Session، فایل‌ها محدود به حداکثر ۲۵ مگابایت هرکدام و XLSX، نتیجه در Session حافظه‌ای با انقضای ۱۲ ساعت، و جدول دارای Pagination پنجاه‌تایی است. متد Mode حتی در صورت دست‌کاری درخواست HTTP همیشه ENHANCED است. `/settings` و مسیرهای استعلام در نسخه ۱ تعریف نشده‌اند.

## ۷. تصمیم‌های معماری

- **بدون Microservice/Kafka/DB:** Core مستقل در یک پروسه.
- **بدون Decimal Floating Point:** گزارش مالی با `bigint`.
- **بدون API اجباری:** کاربری آفلاین هر دو مود در Source برقرار.
- **بدون حدس‌زدن:** خروجی `UNRESOLVED` مستقل از مغایرت قطعی.
- **بدون وابستگی Core به Web/Excel/HTTP:** تست مستقل Domain سریع و ارزان.
