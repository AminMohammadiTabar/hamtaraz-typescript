import { Source, Type } from '../domain/models.ts';
import type { RawExcelRow, Transaction } from '../domain/models.ts';

/** Mirrors Java NormalizationText: comparable text, identifiers still strings. */
export function canonical(input: unknown): string {
  return String(input ?? '').normalize('NFKC').replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ').replace(/[\u200e\u200f\ufeff]/g, '')
    .replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660)).replace(/\s+/g, ' ').trim();
}
const optional = (s: unknown): string | null => canonical(s) || null;
const upper = (s: unknown): string | null => optional(s)?.toUpperCase() ?? null;
export function toTenDigitNationalId(id: string): string {
  const value = canonical(id);
  if (!/^\d{8,10}$/.test(value)) throw new Error('National ID must contain 8 to 10 digits');
  return value.padStart(10, '0');
}
export function bankTrackingSuffix(value: string | null): string | null {
  const found = canonical(value).match(/(BCG[A-Z][0-9]{4})$/i);
  return found?.[1]?.toUpperCase() ?? null;
}
/** Exact whole-rial parse, including scientific notation, with no floating-point money. */
export function wholeRials(text: string | number | bigint | null | undefined, zeroAllowed = false): bigint {
  const raw = canonical(text).replace(/[,٬\u00a0\s]/g, '').replace(/٫/g, '.');
  if (zeroAllowed && (raw === '' || raw === '-')) return 0n;
  const m = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!m) throw new Error('Invalid whole-rial amount');
  const exp = Number(m[4] ?? 0);
  if (!Number.isInteger(exp) || Math.abs(exp) > 100) throw new Error('Out-of-range monetary exponent');
  const fractional = m[3] ?? '';
  const decimalShift = exp - fractional.length;
  let digits = BigInt(m[2] + fractional);
  if (decimalShift >= 0) digits *= 10n ** BigInt(decimalShift);
  else {
    const divisor = 10n ** BigInt(-decimalShift);
    if (digits % divisor !== 0n) throw new Error('Monetary amount must be a whole rial');
    digits /= divisor;
  }
  if (m[1] === '-') digits = -digits;
  if (digits < 0n || (!zeroAllowed && digits === 0n)) throw new Error('Invalid non-positive monetary amount');
  return digits;
}
const unique = (texts: string[], regex: RegExp, code: string, raw: RawExcelRow): string | null => {
  const found = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(regex)) found.add(match[1]!);
  if (found.size > 1) throw new NormalizationError(code, raw, 'Conflicting identifiers');
  return [...found][0] ?? null;
};
const capture = (text: string, regex: RegExp): string | null => text.match(regex)?.[1]?.trim() || null;
const digits = String.raw;
const MC = /(?<![A-Z0-9])MC\s*([0-9]{8,10})(?![0-9])/gi;
const NUMBER19 = /(?<![0-9])([0-9]{19})(?![0-9])/g;
const ACCOUNT13 = /(?<![0-9])([0-9]{13})(?![0-9])/g;
const MOFID_LABELED = /(?:دریافت\s+طی\s+مفید\s*کارت\s+به\s+شماره|شناسه\s+تراکنش|شماره\s+تراکنش|شناسه\s+یکتای)\s*:?\s*([0-9]+)/g;
const MOFID_RECEIPT = /دریافت\s+طی\s+مفید\s*کارت\s+به\s+شماره\s+([0-9]{19})(?![0-9])/g;
const MOFID_TRANSACTION = /(?:شناسه\s+تراکنش|شماره\s+تراکنش|شناسه\s+یکتای)\s*:?\s*([0-9]{19})(?![0-9])/g;

export class NormalizationError extends Error {
  constructor(public readonly code: string, public readonly sourceRow: RawExcelRow, message: string) { super(message); this.name = 'NormalizationError'; }
}
/** Source-aware extraction, without assuming that MC means card-deposit type. */
export function normalize(raw: RawExcelRow): Transaction {
  const c = raw.columns;
  const base = { source: raw.source, sheetName: raw.sheetName, excelRowNumber: raw.excelRowNumber,
    rawColumns: { ...c } };
  try {
    if (raw.source === Source.BANK) {
      const a = canonical(c['توضیحات']), b = canonical(c['توضیحات اضافی']);
      const mc = unique([a, b], MC, 'AMBIGUOUS_NATIONAL_ID', raw);
      if (!mc && [a,b].some(s => s.toUpperCase().includes('MC')))
        throw new NormalizationError('INVALID_MC', raw, 'MC marker found without valid ID');
      const accountNumber = unique([a, b], ACCOUNT13, 'AMBIGUOUS_ACCOUNT', raw);
      const bankExternalTransactionId = unique([a,b], NUMBER19, 'AMBIGUOUS_TRANSACTION_ID', raw);
      const reversed = /\breversed\b|^برگشت\s*:|^اصلاح\s*:/i.test(a) || /\breversed\b|^برگشت\s*:|^اصلاح\s*:/i.test(b);
      return { ...base, date: parseDate(c['تاریخ']), amountRials: wholeRials(c['مبلغ واریز (ریال)']),
        trackingNumber: upper(c['شماره پیگیری']), referenceId: null, mofidTransactionId: null,
        bankExternalTransactionId, nationalId: mc ? toTenDigitNationalId(mc) : null,
        accountNumber, depositorName: null, type: reversed ? Type.REVERSAL : Type.UNKNOWN };
    }
    const narration = canonical(c['شرح ردیف سند']);
    const doc = canonical(c['نوع سند']);
    const type = doc === 'واریز وجه از مفید کارت ملی' ? Type.CARD
      : ['انتقال وجه واسط بانک ملی', 'انتقال وجه عودت شارژ بانک ملی'].includes(doc) ? Type.ACCOUNT
      : ['اصلاح مفید کارت ملی', 'اصلاحیه مسدودی برداشت حسابی'].includes(doc) ? Type.REVERSAL : Type.UNKNOWN;
    for (const m of narration.matchAll(MOFID_LABELED)) if (m[1]!.length !== 19)
      throw new NormalizationError('INVALID_MOFID_TRANSACTION_ID', raw, 'Mofid ID must contain exactly 19 digits');
    const id1 = unique([narration], MOFID_RECEIPT, 'AMBIGUOUS_MOFID_TRANSACTION_ID', raw);
    const id2 = unique([narration], MOFID_TRANSACTION, 'AMBIGUOUS_MOFID_TRANSACTION_ID', raw);
    if (id1 && id2 && id1 !== id2) throw new NormalizationError('AMBIGUOUS_MOFID_TRANSACTION_ID', raw, 'Conflicting Mofid IDs');
    const nationalId = capture(narration, /شناسه\s+ملی\s*:?\s*([0-9]{8,10})(?![0-9])/);
    const name = type === Type.CARD
      ? capture(narration, /واریز\s*کننده\s*:\s*(.*?)(?=\s*@@|\s*\||$)/s)
      : type === Type.ACCOUNT
      ? capture(narration, /مربوط\s+به\s+(.*?)\s+به\s+شناسه\s+ملی/s)
      : type === Type.REVERSAL
      ? capture(narration, /برای\s+مشتری\s+با\s+عنوان\s+(.*?)\s+با\s+شناسه\s+ملی/s) : null;
    return { ...base, date: parseDate(c['تاریخ سند']), amountRials: wholeRials(c['بدهکار']),
      trackingNumber: upper(capture(narration, /شناسه\s+پیگیری\s*:\s*([A-Za-z0-9_-]+)/)),
      referenceId: upper(capture(narration, /شناسه\s+مرجع\s*:\s*([A-Za-z0-9_-]+)/)),
      mofidTransactionId: id1 ?? id2, bankExternalTransactionId: null,
      nationalId: nationalId ? toTenDigitNationalId(nationalId) : null,
      accountNumber: capture(narration, /واریز\s+از\s+شبا\s*:\s*([0-9]{13})(?![0-9])/),
      depositorName: optional(name), type };
  } catch (err) {
    if (err instanceof NormalizationError) throw err;
    throw new NormalizationError('INVALID_TRANSACTION', raw, (err as Error).message);
  }
}
export const normalizeAll = (raw: RawExcelRow[]): Transaction[] => raw.map(normalize);

const PERSIAN_EPOCH = 1_948_321, UNIX_EPOCH = 2_440_588;
function persianJdn(year: number, month: number, day: number): number {
  const epBase = year - (year >= 0 ? 474 : 473);
  const epYear = 474 + ((epBase % 2820) + 2820) % 2820;
  const months = month <= 7 ? (month - 1) * 31 : (month - 1) * 30 + 6;
  return day + months + Math.floor((epYear * 682 - 110) / 2816) + (epYear - 1) * 365
    + Math.floor(epBase / 2820) * 1_029_983 + PERSIAN_EPOCH - 1;
}
/** Java-compatible LocalDate conversion: Solar Hijri date -> Gregorian ISO date. */
export function parseDate(text?: string): string {
  const m = canonical(text).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) throw new Error('Expected date YYYY/MM/DD');
  const y = +m[1]!, month = +m[2]!, day = +m[3]!;
  if (y >= 1900 && y <= 2200) {
    const d = new Date(Date.UTC(y, month - 1, day));
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw new Error('Invalid Gregorian date');
    return d.toISOString().slice(0, 10);
  }
  if (y < 1200 || y > 1600 || month < 1 || month > 12 || day < 1) throw new Error('Invalid Solar Hijri date');
  const maxDay = month <= 6 ? 31 : month <= 11 ? 30 : persianJdn(y + 1, 1, 1) - persianJdn(y, 1, 1) === 366 ? 30 : 29;
  if (day > maxDay) throw new Error('Invalid Solar Hijri day');
  return new Date((persianJdn(y, month, day) - UNIX_EPOCH) * 86400_000).toISOString().slice(0, 10);
}
