import { ReconciliationEngine } from '../domain/engine.ts';
import { DiscrepancyType, Mode, Source, Type } from '../domain/models.ts';
import type { IdentityInquiryPort, ReconciliationMode, ReconciliationResult, Transaction } from '../domain/models.ts';
import { normalizeAll } from '../normalization/normalizer.ts';
import { parseWorkbookBuffer } from '../infrastructure/excel/parser.ts';
import type { ExclusionReason, ParseReport } from '../infrastructure/excel/parser.ts';

export interface ReconciliationRun {
  result: ReconciliationResult;
  createdAt: string;
  bankFilename: string;
  tbsFilename: string;
  bankExclusions: Partial<Record<ExclusionReason, number>>;
  tbsExclusions: Partial<Record<ExclusionReason, number>>;
}
export interface PreparedReconciliation {
  bank: Transaction[];
  tbs: Transaction[];
  localRun: ReconciliationRun;
  plannedNationalIds: string[];
  lookupCount: number;
  mode: ReconciliationMode;
}

/** Last-resort API preflight; only unresolved same-amount candidates qualify. */
export function planIdentityLookups(bank: Transaction[], tbs: Transaction[], local: ReconciliationResult): string[] {
  if (local.summary.balanced) return [];
  const unresolved = local.discrepancies.filter(d => d.type === DiscrepancyType.UNRESOLVED).map(d => d.transaction);
  const hasBank = unresolved.some(t => t.source === Source.BANK), hasTbs = unresolved.some(t => t.source === Source.TBS);
  const delta = local.summary.amountDifferenceRials;
  const limit = delta < 0n ? -delta : delta;
  // Critical v1.0.1 fix: never filter large unresolved two-sided matches by a small net difference.
  const candidates = hasBank && hasTbs ? unresolved : unresolved.filter(t => t.amountRials <= limit);
  const eligibleAmounts = new Set(candidates.filter(t => t.source === Source.TBS && t.type !== Type.REVERSAL && t.depositorName?.trim())
    .map(t => t.amountRials.toString()));
  return [...new Set(candidates.filter(t => t.source === Source.BANK && t.type !== Type.REVERSAL
    && t.nationalId && eligibleAmounts.has(t.amountRials.toString())).map(t => t.nationalId!))].sort();
}
function verify(report: ParseReport, normalized: Transaction[]): void {
  if (report.rows.length !== normalized.length || normalized.some(t => t.source !== report.source))
    throw new Error('Parser/Normalizer count or source mismatch');
  const total = normalized.reduce((sum, t) => sum + t.amountRials, 0n);
  if (total !== report.depositTotalRials) throw new Error('Parser/Normalizer amount mismatch');
}
/** Application orchestration; pure domain remains independent of Excel and HTTP. */
export class ReconciliationService {
  async prepare(bankFile: Buffer, tbsFile: Buffer, mode: ReconciliationMode,
                bankName = 'bank.xlsx', tbsName = 'tbs.xlsx'): Promise<PreparedReconciliation> {
    const started = performance.now();
    // Match the Java pipeline's sequential workbook lifecycle. ExcelJS parsing is
    // CPU- and memory-intensive; loading both books concurrently can increase GC
    // pressure without reducing wall-clock time on a single Node event loop.
    const bankRaw = await parseWorkbookBuffer(bankFile, Source.BANK);
    const tbsRaw = await parseWorkbookBuffer(tbsFile, Source.TBS);
    const parsedAt = performance.now();
    const bank = normalizeAll(bankRaw.rows), tbs = normalizeAll(tbsRaw.rows);
    verify(bankRaw, bank); verify(tbsRaw, tbs);
    const normalizedAt = performance.now();
    const prepared = await this.prepareTransactions(bank, tbs, mode, bankName, tbsName,
      bankRaw.excludedCounts, tbsRaw.excludedCounts);
    const finishedAt = performance.now();
    console.info(`[hamtaraz][pipeline] bankRows=${bank.length} tbsRows=${tbs.length}` +
      ` parseAndLoadMs=${Math.round(parsedAt-started)} normalizeMs=${Math.round(normalizedAt-parsedAt)}` +
      ` matchAndPlanMs=${Math.round(finishedAt-normalizedAt)} totalMs=${Math.round(finishedAt-started)}`);
    return prepared;
  }
  /** Test seam: same matching workflow, but rows already normalized. */
  async prepareTransactions(bank: Transaction[], tbs: Transaction[], mode: ReconciliationMode,
                            bankName = 'bank.xlsx', tbsName = 'tbs.xlsx',
                            bankExclusions: ReconciliationRun['bankExclusions'] = {},
                            tbsExclusions: ReconciliationRun['tbsExclusions'] = {}): Promise<PreparedReconciliation> {
    const result = await new ReconciliationEngine().reconcile(bank, tbs, mode);
    const localRun: ReconciliationRun = { result, createdAt: new Date().toISOString(),
      bankFilename: bankName, tbsFilename: tbsName, bankExclusions, tbsExclusions };
    const plannedNationalIds = planIdentityLookups(bank, tbs, result);
    return { bank, tbs, localRun, plannedNationalIds, lookupCount: plannedNationalIds.length, mode };
  }
  async finishWithIdentity(prepared: PreparedReconciliation, approvedPort: IdentityInquiryPort): Promise<ReconciliationRun> {
    const result = await new ReconciliationEngine(approvedPort).reconcile(prepared.bank, prepared.tbs, prepared.mode);
    return { ...prepared.localRun, result, createdAt: new Date().toISOString() };
  }
}
