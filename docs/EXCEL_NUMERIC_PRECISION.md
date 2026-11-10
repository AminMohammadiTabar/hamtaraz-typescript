# Excel numeric precision and parser behavior

## Root cause

ExcelJS exposes numeric XLSX cells as JavaScript `Number`. JavaScript cannot represent every integer above `Number.MAX_SAFE_INTEGER` (`9,007,199,254,740,991`) exactly. The previous parser called `cellText()` for every populated column, including informational balance columns that are not used in reconciliation. A large running balance therefore stopped the entire import even though all required transaction fields were valid.

## Fix in 1.0.1-ts.3

- Parse only the required business columns for each source.
- Ignore non-contract columns such as TBS running balances and bank available/current balances.
- Do not coerce numeric cells during header discovery.
- Keep rejecting unsafe numeric values in required monetary or identifier columns. This is intentional: silently using a rounded `Number` could corrupt a reconciliation result.
- Keep rejecting populated data beyond the detected header width.

## Evidence from the supplied TBS sample

The supplied original TBS workbook contains numeric value `1.53247249439496E+16` in cell `K15288`, under header `مانده بستانکار`. This is above JavaScript's safe integer limit and is not a field used by the reconciliation engine. The new parser ignores it. The reported row `23841` belongs to the workbook used in the user's latest run; its exact cell value was not available in that run's attachment, but it is consistent with the same class of issue.

## Validation

- Parser tests: 10 passed.
- Full available Node test suite: 42 passed, 0 failed, 3 skipped.
- The skipped tests require installed ExcelJS/Mustache dependencies and/or the real Golden workbook paths. The full XLSX-to-HTTP integration run remains to be performed on the target Windows machine after `npm install`.
