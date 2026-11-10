import { Source } from '../../domain/models.ts';
import type { RawExcelRow, TransactionSource } from '../../domain/models.ts';
import { canonical, wholeRials } from '../../normalization/normalizer.ts';

/** Row decisions deliberately enumerate every excluded row; no silent dropping. */
export type ExclusionReason = 'EMPTY_ROW' | 'BANK_WITHDRAWAL' | 'TBS_OPENING_BALANCE' | 'TBS_ACCOUNT_WITHDRAWAL' | 'TBS_TOTAL_ROW';
export interface ParseReport {
  source: TransactionSource;
  sheetName: string;
  rows: RawExcelRow[];
  excludedCounts: Partial<Record<ExclusionReason, number>>;
  depositTotalRials: bigint;
}
export class ExcelParseError extends Error {
  constructor(public readonly code: string, public readonly sheetName: string | null,
              public readonly excelRowNumber: number, message: string) { super(message); this.name = 'ExcelParseError'; }
}
interface SpreadsheetCell { value: unknown; type?: number; }
interface SpreadsheetRow {
  cellCount: number;
  getCell(index: number): SpreadsheetCell;
  hasValues?: boolean;
}
interface SpreadsheetSheet { name: string; rowCount: number; getRow(index: number): SpreadsheetRow; }
interface SpreadsheetBook { worksheets: SpreadsheetSheet[]; xlsx: { load(buf: Buffer, options?: { ignoreNodes?: string[] }): Promise<unknown> }; }

const bankHeaders = ['تاریخ', 'مبلغ واریز (ریال)', 'مبلغ برداشت (ریال)', 'شماره پیگیری', 'توضیحات', 'توضیحات اضافی'];
const tbsHeaders = ['کد حساب', 'نام حساب', 'تاریخ سند', 'شماره سند', 'نوع سند', 'شرح ردیف سند', 'بدهکار', 'بستانکار'];
const headerKey = (str: string): string => canonical(str).replace(/[\u00a0\u200d]/g, ' ').replace(/\s+/g, ' ');
function columnLetter(col: number): string {
  let result = '';
  while (col > 0) { col--; result = String.fromCharCode(65 + col % 26) + result; col = Math.floor(col / 26); }
  return result;
}
function requiredSetHasAll(required: Set<string>, found: Map<string, number>): boolean {
  for (const name of required) if (!found.has(name)) return false;
  return true;
}
/** Header discovery must never coerce arbitrary numeric metadata into JS Number text. */
function headerCellText(cell: SpreadsheetCell, sheet: string, row: number): string {
  const value = cell?.value;
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && ('richText' in value || 'text' in value || 'hyperlink' in value))
    return cellText(cell, sheet, row);
  // Numeric/date values cannot be valid report headers; ignore them safely.
  return '';
}
function hasCellValue(cell: SpreadsheetCell): boolean {
  const value = cell?.value;
  return value !== null && value !== undefined && value !== '';
}
/**
 * ExcelJS is loaded only at the Infrastructure boundary. Formula cells are
 * rejected. Only reconciliation-contract columns are converted; unrelated balance columns are ignored.
 * Unsafe integers in required fields are rejected rather than silently rounded.
 */
function cellText(cell: SpreadsheetCell, sheet: string, row: number, field?: string, column?: number): string {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (!Number.isSafeInteger(value) && Number.isInteger(value))) {
      const location = field ? ` in required field '${field}' (${columnLetter(column ?? 1)}${row})` : '';
      throw new ExcelParseError('UNSAFE_NUMERIC_CELL', sheet, row, `Excel numeric value exceeds JS safe integer precision${location}; store the value as text or correct the source cell`);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return `${value.getUTCFullYear()}/${String(value.getUTCMonth()+1).padStart(2,'0')}/${String(value.getUTCDate()).padStart(2,'0')}`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('formula' in obj || 'sharedFormula' in obj) throw new ExcelParseError('FORMULA_CELL', sheet, row, 'Formula cells are not permitted');
    if ('error' in obj) throw new ExcelParseError('ERROR_CELL', sheet, row, 'Excel error value');
    if ('richText' in obj && Array.isArray(obj.richText)) return obj.richText.map(i => (i as {text?:string}).text ?? '').join('').trim();
    if ('text' in obj && typeof obj.text === 'string') return obj.text.trim();
    if ('hyperlink' in obj && typeof obj.text === 'string') return obj.text.trim();
  }
  throw new ExcelParseError('UNSUPPORTED_CELL', sheet, row, 'Unsupported Excel cell value type');
}
function amount(cols: Record<string, string>, header: string, sheet: string, row: number): bigint {
  try { return wholeRials(cols[header], true); }
  catch { throw new ExcelParseError('INVALID_AMOUNT', sheet, row, `Invalid whole-rial amount in ${header}`); }
}
function decide(source: TransactionSource, c: Record<string, string>, sheet: string, row: number): { amount: bigint } | { skip: ExclusionReason } {
  if (source === Source.BANK) {
    const deposited = amount(c, 'مبلغ واریز (ریال)', sheet, row);
    const withdrawn = amount(c, 'مبلغ برداشت (ریال)', sheet, row);
    if (deposited > 0n && withdrawn === 0n) {
      if (!c['تاریخ']?.trim()) throw new ExcelParseError('MISSING_DATE', sheet, row, 'Bank date is missing');
      return { amount: deposited };
    }
    if (deposited === 0n && withdrawn > 0n) return { skip: 'BANK_WITHDRAWAL' };
    throw new ExcelParseError('INVALID_BANK_ROW', sheet, row, 'Exactly one bank deposit or withdrawal amount must be positive');
  }
  const narration = canonical(c['شرح ردیف سند']);
  if (canonical(c['کد حساب']) === 'جمع کل') return { skip: 'TBS_TOTAL_ROW' };
  if (narration === 'مانده نقل از قبل') return { skip: 'TBS_OPENING_BALANCE' };
  const withdrawn = narration.match(/^برداشت از\s+(\d{13})$/);
  const account = canonical(c['نام حساب']).match(/-\s*(\d{13})$/);
  if (withdrawn && account && withdrawn[1] === account[1]) return { skip: 'TBS_ACCOUNT_WITHDRAWAL' };
  const debit = amount(c, 'بدهکار', sheet, row), credit = amount(c, 'بستانکار', sheet, row);
  if (debit <= 0n || credit !== 0n) throw new ExcelParseError('INVALID_TBS_ROW', sheet, row, 'Expected positive debit and zero credit');
  if (!narration || !c['تاریخ سند']?.trim() || !c['نوع سند']?.trim())
    throw new ExcelParseError('MISSING_TBS_DATA', sheet, row, 'Required TBS deposit value is missing');
  return { amount: debit };
}
/** Reusable for both the upload server and golden-file tests. */
export async function parseWorkbookBuffer(data: Buffer, source: TransactionSource): Promise<ParseReport> {
  // @ts-ignore -- ExcelJS is installed by npm; no runtime dependency in Domain
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook() as SpreadsheetBook;
  const loadStarted = performance.now();
  try {
    // Bank exports may contain a decorative image and stale worksheet dimensions (A1).
    // Neither affects reconciliation data, so skip presentation-only XML nodes.
    await workbook.xlsx.load(data, { ignoreNodes: [
      'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'autoFilter', 'mergeCells',
      'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions',
      'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
      'customProperties', 'cellWatches', 'ignoredErrors', 'extLst', 'legacyDrawing',
      'drawing', 'picture', 'tableParts'
    ] });
  } catch (e) {
    throw new ExcelParseError('UNREADABLE_FILE', null, 0, `Cannot open XLSX workbook: ${(e as Error).message}`);
  }
  const loadedAt = performance.now();
  const report = parseWorkbook(workbook, source);
  const finishedAt = performance.now();
  console.info(`[hamtaraz][xlsx] source=${source} bytes=${data.byteLength} rows=${report.rows.length}` +
    ` loadMs=${Math.round(loadedAt-loadStarted)} rowParseMs=${Math.round(finishedAt-loadedAt)}` +
    ` totalMs=${Math.round(finishedAt-loadStarted)}`);
  return report;
}
/** Pure workbook adapter for unit tests; ExcelJS is not required in Domain tests. */
export function parseWorkbook(workbook: Pick<SpreadsheetBook,'worksheets'>, source: TransactionSource): ParseReport {
  const required = source === Source.BANK ? bankHeaders : tbsHeaders;
  const requiredSet = new Set(required.map(headerKey));
  let found: { sheet: SpreadsheetSheet; headerRow: number; headers: string[] } | null = null;
  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= Math.min(40, sheet.rowCount); rowNumber++) {
      const row = sheet.getRow(rowNumber);
      if (row.cellCount <= 0 || row.cellCount > 128) continue;
      const headers: string[] = [];
      const firstColumnByHeader = new Map<string, number>();
      const duplicateRequired: string[] = [];
      for (let col = 1; col <= row.cellCount; col++) {
        const name = headerKey(headerCellText(row.getCell(col), sheet.name, rowNumber));
        if (!name) {
          headers.push(`COLUMN_${columnLetter(col)}`);
          continue;
        }
        const firstColumn = firstColumnByHeader.get(name);
        if (firstColumn !== undefined) {
          // Optional/decoration columns can repeat in bank exports. Keep the later
          // value under a synthetic name instead of rejecting an otherwise valid file.
          if (requiredSet.has(name)) duplicateRequired.push(
            `${name} (${columnLetter(firstColumn)} and ${columnLetter(col)})`
          );
          headers.push(`${name}__DUPLICATE_${columnLetter(col)}`);
        } else {
          firstColumnByHeader.set(name, col);
          headers.push(name);
        }
      }
      if (!requiredSetHasAll(requiredSet, firstColumnByHeader)) continue;
      if (duplicateRequired.length) throw new ExcelParseError('DUPLICATE_HEADERS', sheet.name, rowNumber,
        `Required Excel header is duplicated: ${duplicateRequired.join('; ')}`);
      if (found) throw new ExcelParseError('AMBIGUOUS_SHEET', sheet.name, rowNumber, 'Multiple matching report sheets');
      found = { sheet, headerRow: rowNumber, headers };
    }
  }
  if (!found) throw new ExcelParseError('HEADER_NOT_FOUND', null, 0, `Missing required ${source} headers`);
  const { sheet, headerRow, headers } = found;
  let total = 0n;
  const rows: RawExcelRow[] = [], excludedCounts: ParseReport['excludedCounts'] = {};
  const skip = (reason: ExclusionReason): void => { excludedCounts[reason] = (excludedCounts[reason] ?? 0) + 1; };
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const cols: Record<string, string> = {}; let hasValue = false;
    // Only read the business-contract columns. Bank balance and TBS running-balance
    // columns are informational and may contain integers beyond Number.MAX_SAFE_INTEGER.
    // Coercing those unrelated cells would reject an otherwise valid reconciliation.
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]!;
      if (!requiredSet.has(header)) continue;
      const text = cellText(row.getCell(i + 1), sheet.name, rowNumber, header, i + 1);
      cols[header] = text;
      if (text) hasValue = true;
    }
    // Preserve the structural guard without converting arbitrary numeric values.
    for (let i = headers.length + 1; i <= row.cellCount; i++)
      if (hasCellValue(row.getCell(i)))
        throw new ExcelParseError('UNEXPECTED_COLUMN', sheet.name, rowNumber, 'Data beyond header columns');
    if (!hasValue) { skip('EMPTY_ROW'); continue; }
    const decision = decide(source, cols, sheet.name, rowNumber);
    if ('skip' in decision) { skip(decision.skip); continue; }
    if (decision.amount <= 0n) throw new ExcelParseError('INVALID_DEPOSIT', sheet.name, rowNumber, 'Deposit must be positive');
    rows.push({ source, sheetName: sheet.name, excelRowNumber: rowNumber, columns: cols });
    total += decision.amount;
  }
  if (!rows.length) throw new ExcelParseError('NO_DEPOSITS', sheet.name, 0, 'No eligible transactions');
  return { source, sheetName: sheet.name, rows, excludedCounts, depositTotalRials: total };
}
