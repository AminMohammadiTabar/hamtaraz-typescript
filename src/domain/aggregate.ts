import { Source, assertTransaction, position } from './models.ts';
import type { ReconciliationSummary, Transaction, TransactionSource } from './models.ts';
/** Authoritative business gate: balanced counts and totals means finish immediately. */
export function summarize(bank: Transaction[], tbs: Transaction[]): ReconciliationSummary {
  function tally(input: Transaction[], expected: TransactionSource): bigint {
    let total = 0n; const seen = new Set<string>();
    for (const tx of input) {
      assertTransaction(tx);
      if (tx.source !== expected) throw new Error(`Unexpected source ${tx.source}`);
      const key = position(tx);
      if (seen.has(key)) throw new Error(`Duplicate physical Excel row: ${key}`);
      seen.add(key); total += tx.amountRials;
    }
    return total;
  }
  const bankTotalRials = tally(bank, Source.BANK), tbsTotalRials = tally(tbs, Source.TBS);
  return { bankCount: bank.length, tbsCount: tbs.length, bankTotalRials, tbsTotalRials,
    countDifference: bank.length - tbs.length,
    amountDifferenceRials: bankTotalRials - tbsTotalRials,
    balanced: bank.length === tbs.length && bankTotalRials === tbsTotalRials };
}
