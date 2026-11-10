# Hamtaraz 1.0.1 — TypeScript Port (Preview)

تبدیل یکپارچه و قابل تست از نسخه Java 1.0.1. این پروژه **معادل‌سازی** است و هنوز انتشار Production یا استقرار روی سرور محسوب نمی‌شود.

- پورت کردن Core و قوانین Standard و Enhanced بدون وابستگی به ExcelJS.
- پورت Normalizer: شناسه یکتای مفید از شناسه بانک جدا باقی مانده است.
- پردازش ریال با `bigint`؛ تطبیق Grouped و نگهداری ردیف اصلی.
- پورت Parser و Writer XLSX با ExcelJS؛ مرورگر RTL نسخه ۱ با Mustache و TypeScript سمت Client.
- کد API هویت و زمان‌بندی محفوظ اما Routes تنظیمات/تأیید در نسخه عمومی مخفی و غیرفعال.
- CSRF token، Session در حافظه، محدودیت فایل و خروجی Excel با رشته‌های امن.
- رگرسیون مهم `v1.0.1`: عدم حذف کاندیداهای بزرگ دوطرفه به دلیل اختلاف خالص کوچک.

## اعتبارسنجی انجام‌شده

`npm run build` موفق (TypeScript strict؛ با ابزار نصب‌شده محلی). `npm test`: ۳۳ Pass، ۳ Skip (Integration وابسته به npm و Golden source)، صفر Fail.

تست مستقل روی RawExcelRow‌های استخراج‌شده از دو فایل واقعی ۵ آبان: ۱۵٬۲۷۸ جفت و ۳ مغایرت بانک، صفر مغایرت TBS، صفر نامشخص، با جمع ۲۴٬۱۹۹٬۹۰۰ ریال. خود ExcelJS و مسیر HTTP کامل هنوز نیاز به `npm install` و اجرای Integration Tests دارد.

## Upload compatibility fix

- The browser client is compiled as an ES module by TypeScript. The public upload
  page now loads it with `type="module"`; this prevents a browser parse error on
  the emitted `export {}` marker and restores file-selection feedback, drag/drop,
  and submit-state handling.
- The server now validates multipart requests explicitly and accepts `.xlsx`
  extensions case-insensitively, matching browser-side validation.
- Upload failures are logged server-side without logging workbook contents, while
  a user-facing error is rendered back on the upload page.


## 1.0.1-ts.2 — Excel parser diagnostics and performance

- Workbook parsing is now sequential, matching the Java application's lifecycle and avoiding concurrent ExcelJS workbook allocations.
- ExcelJS ignores presentation-only worksheet XML nodes (including drawings/images, page setup, view metadata and stale `dimension` metadata) while retaining cell data.
- Duplicate required headers still fail safely, but the error now identifies the header and both column letters. Repeated optional/non-required headers do not reject the report; non-contract columns are not copied into the reconciliation row model.
- Error messages now include the worksheet name.
- Added timing logs for workbook loading/parsing, normalization, matching and lookup planning. Logs contain counts, byte sizes and durations only; no transaction values or personal data.
- Added parser regression tests for the actual report header layouts: Bank row 8 and TBS row 6, including blank separator columns.
- Local full Node test run: 40 passed, 0 failed, 3 skipped (ExcelJS/Mustache integration and Golden XLSX tests require npm dependencies). The real ExcelJS Golden test still needs to be run on the target Windows machine after `npm install`.


## Performance diagnostic baseline

A synthetic Core benchmark with 15,281 bank transactions and 15,278 TBS transactions completed Enhanced matching in approximately 161 ms in this environment. A synthetic 15,288-row parser-adapter benchmark completed in approximately 150 ms. These measurements exclude ExcelJS ZIP/XML workbook loading and therefore do not represent end-to-end upload time. The server now logs `loadMs`, `rowParseMs`, `normalizeMs`, `matchAndPlanMs` and `totalMs` so the actual Windows machine can identify the bottleneck.


## 1.0.1-ts.3 — Ignore unrelated unsafe balance cells

- Fixed `UNSAFE_NUMERIC_CELL` failures caused by large values in non-business balance columns. The parser now converts only the required reconciliation columns and ignores informational columns that are not used by matching.
- Header discovery no longer attempts to coerce numeric metadata cells into JavaScript strings.
- Structural checks for data beyond the header width remain in place without converting those values.
- Unsafe numeric values in required fields are still rejected to protect monetary precision; the error now identifies the required field and cell address.
- Added regression tests for large values in bank/TBS informational balances and for rejecting unsafe values in required monetary fields.
- Local Node test run: 42 passed, 0 failed, 3 skipped. The three skips remain the ExcelJS/Mustache integration and Golden XLSX tests, which require installed npm dependencies and Golden file paths.


## v1.0.1-ts.4 — B Lotus font diagnostics

- Added `/diagnostics/font` to report whether the local B Lotus font exists and has a recognized SFNT signature.
- Font responses now include explicit content length, `font/ttf`, no-store caching, and same-origin resource policy.
- Invalid font signatures return HTTP 415; missing fonts return HTTP 404 with an actionable message.
- Added `scripts/check-font.ps1` and exact installation instructions.
- Updated the CSS font-family alias and cache-busting query string.
