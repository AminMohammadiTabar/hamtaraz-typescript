# هم‌تراز — TypeScript Edition (`1.0.1-ts.4`)

**تبدیل پروژه Java/Spring Boot هم‌تراز نسخه 1.0.1 به TypeScript / Node.js.**

این مخزن حاوی Backend، UI، الگوریتم‌های هر دو مود، خواندن Excel، گزارش XLSX و تست‌ها است؛ تبدیل صرفاً Frontend نیست. UI نسخه عمومی فقط **مود تقویت‌شده (Enhanced)** را نمایش می‌دهد. مود Standard و کد تنظیمات و استعلام اختیاری هویت در سورس حفظ شده‌اند، اما در نسخه عمومی، Endpoint مرتبط ارائه نمی‌شود.

## پیش‌نیازها و اجرا

- Node.js نسخه `22.16+` و npm
- برای Build: TypeScript 5.8 (همراه وابستگی‌های توسعه)

```bash
npm install
npm run build
npm run start:build
```

سپس مرورگر: `http://localhost:8080`.

برای توسعه بدون Build (Node.js 22):

```bash
npm run dev
```

> `npm install` به مخزن npm نیاز دارد. آزمون‌های Golden با فایل‌های اصلی باید در محیطی که ExcelJS نصب است اجرا شوند. برای این نسخه، زمان بارگذاری هر فایل و زمان هر مرحله در پنجره سرور ثبت می‌شود تا گلوگاه واقعی قابل اندازه‌گیری باشد.

## اجرای تست‌ها

```bash
npm test
npm run typecheck
```

- `test/core.test.ts`: کنترل تجمیعی، دو استراتژی و ابهام تکراری‌ها.
- `test/normalization.test.ts`: استخراج MC، شناسه یکتای مفید، صفرهای اول و تاریخ.
- `test/planner.test.ts`: شمارش استعلام لازم و رگرسیون رفع اشکال `v1.0.1`.
- `test/identity.test.ts`: پیکربندی محدود cURL، فاصله‌گذاری و تخمین زمان.
- `test/parser.test.ts`: تشخیص سربرگ‌های واقعی بانک (ردیف ۸) و TBS (ردیف ۶)، ستون‌های خالی جداکننده، تکرار سربرگ‌های اختیاری، نادیده‌گرفتن ستون‌های مانده غیرضروری با اعداد بزرگ و امنیت گزارش.
- `test/integration.test.ts`: اجرای واقعی XLSX، خروجی چهاربخشی و جریان HTTP. بدون نصب dependencies به طور صریح **Skip** می‌شوند.
- `test/upload-contract.test.ts`: کنترل قرارداد فرم، بارگذاری ES Module و صحت تجزیه multipart در Node.js.
- Golden test اختیاری:

```powershell
$env:GOLDEN_BANK="C:\Reports\خروجی بانک 5 آبان.xlsx"
$env:GOLDEN_TBS="C:\Reports\خروجی 5 آبان تی بی اس.xlsx"
npm test
```

## معماری و فناوری

- **Core:** TypeScript strict، بدون Spring/ExcelJS/HTTP؛ الگوریتم‌ها تابع یا سرویس دارای وضعیت محدود در هر اجرا.
- **حفظ دقت ارقام:** `bigint` (نه `number`) برای مبالغ ریال.
- **Excel Adapter:** `exceljs` برای ورودی XLSX و خروجی چهاربخشی.
- **Web:** HTTP استاندارد Node.js + فرم multipart استاندارد، Mustache برای HTML، CSS و JavaScript تولیدشده از `src/web/client/app.ts`.
- **Identity (غیرفعال در UI):** پیکربندی چهار فیلدی، HTTPS با allowlist، جلوگیری از اجرای Shell و زمان‌بندی پیش‌فرض ۱۰ ثانیه.

مستندات مفصل: `docs/ARCHITECTURE.md`, `docs/MATCHING_RULES.md`, `docs/TESTING.md`, `docs/PORTING_NOTES.md`, `docs/EXCEL_NUMERIC_PRECISION.md`.

## نحوه استفاده

1. Excel بانک ملی و Excel کارگزاری TBS را وارد کنید.
2. روی «شروع مغایرت‌گیری» کلیک کنید؛ موتور تقویت‌شده در Backend اجباری است.
3. گزارش خلاصه و مغایرت‌های «فقط بانک / فقط TBS / نامشخص» را ببینید.
4. گزارش XLSX را دانلود کنید. شماره ردیف دقیق مربوط به فایل اصلی حفظ می‌شود.

## ملاحظات نسخه اول

- نتیجه «تراز تجمیعی» فقط برابری تعداد و مجموع مبلغ است؛ اثبات تک‌به‌تک نیست.
- API خارجی در UI نسخه ۱ در دسترس نیست. در حالت عدم استعلام، تراکنش مبهم به اشتباه «مغایرت قطعی» اعلام نمی‌شود.
- نتایج و نشست‌ها صرفاً در حافظه Node.js نگهداری می‌شوند؛ با راه‌اندازی مجدد از دست می‌روند.
- برای Production به HTTPS، مدیریت نشست و کلیدهای امنیتی پایدار، کنترل نرخ آپلود، ممیزی، کنترل دسترسی و سیاست نگهداری داده نیاز داریم.
- فایل `BLOTUS.TTF` به دلیل مجوز بازتوزیع، داخل بسته نیست. فونت مجاز خودتان را دقیقاً در `public/assets/fonts/BLOTUS.TTF` قرار دهید.
- برای عیب‌یابی شناسایی فونت، پس از اجرای سرور `http://localhost:8080/diagnostics/font` را باز کنید یا `powershell -ExecutionPolicy Bypass -File .\\scripts\\check-font.ps1` را اجرا کنید. اگر `available` و `validSfntSignature` هر دو `true` باشند، سرور فایل را درست می‌خواند.
- اجرای Build و Integration Test کامل به دلیل عدم دسترسی این محیط به npm تأیید نشده؛ Unit Testهای مستقل و Golden روی داده استخراج‌شده اجرا شده‌اند.


## Excel numeric precision fix (1.0.1-ts.3)

The parser now reads only the columns required by the reconciliation contract. Informational bank/TBS balance columns (for example `مانده بدهکار`، `مانده بستانکار` and `مانده`) are not converted to JavaScript `Number`, because large running balances can exceed `Number.MAX_SAFE_INTEGER` and are not used by matching. Unsafe integers in required monetary/identifier fields still fail with a precise cell/column diagnostic instead of being silently rounded.


## عیب‌یابی فونت B Lotus (1.0.1-ts.4)

مسیر دقیق نصب فونت:
`public/assets/fonts/BLOTUS.TTF`

پس از اجرای برنامه:
- `http://localhost:8080/diagnostics/font` وضعیت وجود فایل و امضای TrueType/OpenType را نشان می‌دهد.
- `http://localhost:8080/assets/fonts/BLOTUS.TTF` باید با HTTP 200 و نوع محتوای `font/ttf` پاسخ دهد.
- در ویندوز می‌توان `scripts/check-font.ps1` را اجرا کرد.
- اگر فایل در مسیر صحیح باشد ولی مرورگر هنوز فونت را اعمال نکند، در Firefox/Chrome بخش Network درخواست `BLOTUS.TTF` را بررسی کنید؛ خطای 404 به مسیر/نام فایل، خطای 415 به محتوای نامعتبر و پاسخ 200 همراه با عدم نمایش به خود فایل فونت یا بارگذاری CSS مربوط است.
