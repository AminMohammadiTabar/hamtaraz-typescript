/**
 * Domain contracts for Hamtaraz. Monetary values use bigint (whole rials), never
 * floating point. String identifiers retain leading zeros. Physical Excel row
 * numbers are 1-based and are never recomputed after matching.
 */
export const Source = { BANK: 'BANK_MELLI', TBS: 'TBS' } as const;
export type TransactionSource = typeof Source[keyof typeof Source];
export const Mode = { STANDARD: 'STANDARD', ENHANCED: 'ENHANCED' } as const;
export type ReconciliationMode = typeof Mode[keyof typeof Mode];
export const Type = { CARD: 'CARD_DEPOSIT', ACCOUNT: 'ACCOUNT_DEPOSIT', REVERSAL: 'REVERSAL', UNKNOWN: 'UNKNOWN' } as const;
export type TransactionType = typeof Type[keyof typeof Type];
export const DiscrepancyType = { BANK_ONLY: 'BANK_ONLY', TBS_ONLY: 'TBS_ONLY', UNRESOLVED: 'UNRESOLVED' } as const;
export type DiscrepancyType = typeof DiscrepancyType[keyof typeof DiscrepancyType];
export const Status = { BALANCED: 'RECONCILED_BY_AGGREGATES', FOUND: 'DISCREPANCIES_FOUND', REVIEW: 'NEEDS_REVIEW' } as const;
export type ReconciliationStatus = typeof Status[keyof typeof Status];

export interface RawExcelRow {
  source: TransactionSource;
  sheetName: string;
  excelRowNumber: number;
  columns: Record<string, string>;
}
export interface Transaction {
  source: TransactionSource;
  sheetName: string;
  excelRowNumber: number;
  /** Gregorian ISO date (same semantic as Java LocalDate). */
  date: string;
  amountRials: bigint;
  trackingNumber: string | null;
  referenceId: string | null;
  /** Mofid-issued 19-digit transaction ID, not a bank card number. */
  mofidTransactionId: string | null;
  /** 19-digit identifier extracted from the bank, kept separate until matching. */
  bankExternalTransactionId: string | null;
  nationalId: string | null;
  accountNumber: string | null;
  depositorName: string | null;
  type: TransactionType;
  rawColumns: Record<string, string>;
}
export interface ReconciliationSummary {
  bankCount: number;
  tbsCount: number;
  bankTotalRials: bigint;
  tbsTotalRials: bigint;
  countDifference: number;
  amountDifferenceRials: bigint;
  balanced: boolean;
}
export interface Discrepancy {
  type: DiscrepancyType;
  transaction: Transaction;
  reasonCode: string;
  explanation: string;
}
export interface MatchedPair { bank: Transaction; tbs: Transaction; evidence: string; }
export interface ReconciliationResult {
  mode: ReconciliationMode;
  status: ReconciliationStatus;
  summary: ReconciliationSummary;
  discrepancies: Discrepancy[];
  identityApiCallCount: number;
  /** Non-public diagnostic; cannot be used to infer row-level proof from aggregates. */
  matchedPairs: MatchedPair[];
}
export interface IdentityInquiryPort {
  /** Return a verified last name, or null on failure/not found. */
  findLastName(nationalId: string): Promise<string | null>;
}
export function discrepanciesOfType(result: ReconciliationResult, type: DiscrepancyType): Discrepancy[] {
  return result.discrepancies.filter(d => d.type === type);
}
export function position(tx: Transaction): string { return `${tx.source}::${tx.sheetName}::${tx.excelRowNumber}`; }
export function assertTransaction(tx: Transaction): void {
  if (!tx.sheetName?.trim() || !Number.isInteger(tx.excelRowNumber) || tx.excelRowNumber < 1) throw new Error('Invalid Excel provenance');
  if (tx.amountRials < 0n) throw new Error('Negative deposit amount');
}
