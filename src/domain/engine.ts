import { Mode, Status, Type } from './models.ts';
import type { IdentityInquiryPort, ReconciliationMode, ReconciliationResult, ReconciliationSummary, Transaction } from './models.ts';
import { summarize } from './aggregate.ts';
import { MatchingSession } from './matching-session.ts';
import { bankTrackingSuffix } from '../normalization/normalizer.ts';

/** Strategy-pattern equivalent to Java StandardStrategy / EnhancedStrategy. */
export class ReconciliationEngine {
  constructor(private readonly provider?: IdentityInquiryPort | null) {}
  async reconcile(bank: Transaction[], tbs: Transaction[], mode: ReconciliationMode): Promise<ReconciliationResult> {
    const summary = summarize(bank, tbs);
    if (summary.balanced) return { mode, status: Status.BALANCED, summary, discrepancies: [], identityApiCallCount: 0, matchedPairs: [] };
    const session = new MatchingSession(bank, tbs);
    if (mode === Mode.STANDARD) this.standardRules(session);
    else if (mode === Mode.ENHANCED) this.enhancedRules(session);
    else throw new Error('Unrecognized reconciliation mode');
    const delta = summary.amountDifferenceRials;
    session.applyAmountDifferenceLimit(delta < 0n ? -delta : delta);
    await session.resolveByLastName(this.provider);
    const discrepancies = session.classify();
    return { mode, status: discrepancies.some(d => d.type === 'UNRESOLVED') ? Status.REVIEW : Status.FOUND,
      summary, discrepancies, identityApiCallCount: session.identityApiCallCount, matchedPairs: session.matchedPairs };
  }
  private standardRules(session: MatchingSession): void {
    session.matchByKey('EXPLICIT_MOFID_TRANSACTION_ID_AND_AMOUNT',
      b => b.bankExternalTransactionId !== null && b.type !== Type.REVERSAL,
      t => t.mofidTransactionId !== null && t.type !== Type.REVERSAL,
      b => b.bankExternalTransactionId, t => t.mofidTransactionId);
  }
  private enhancedRules(session: MatchingSession): void {
    const is = (tx: Transaction, label: string): boolean => tx.rawColumns['نوع سند'] === label;
    session.matchByKey('TBS_REFERENCE_SUFFIX_BANK_TRACKING',
      b => b.type !== Type.REVERSAL && b.nationalId !== null && b.trackingNumber !== null,
      t => is(t, 'واریز وجه از مفید کارت ملی') && t.referenceId !== null,
      b => b.trackingNumber, t => bankTrackingSuffix(t.referenceId));
    session.matchByKey('BANK_EXTERNAL_MOFID_ID_TRANSFERS',
      b => b.bankExternalTransactionId !== null,
      t => is(t, 'انتقال وجه واسط بانک ملی') || is(t, 'انتقال وجه عودت شارژ بانک ملی'),
      b => b.bankExternalTransactionId, t => t.mofidTransactionId);
    session.matchByKey('MC_REVERSAL_NATIONAL_ID_AND_AMOUNT',
      b => b.type === Type.REVERSAL && b.nationalId !== null,
      t => is(t, 'اصلاح مفید کارت ملی') && t.nationalId !== null,
      b => b.nationalId, t => t.nationalId);
    session.matchByKey('SPECIAL_TBS_TRACKING_BANK_EXTERNAL_ID',
      b => b.bankExternalTransactionId !== null,
      t => is(t, 'اصلاحیه مسدودی برداشت حسابی') && t.trackingNumber !== null,
      b => b.bankExternalTransactionId, t => t.trackingNumber);
  }
}
