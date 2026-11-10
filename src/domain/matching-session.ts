import { DiscrepancyType, Source, Type, position } from './models.ts';
import type { Discrepancy, IdentityInquiryPort, MatchedPair, Transaction } from './models.ts';

/** Per-run state. Never reuse a transaction from either report in more than one pair. */
export class MatchingSession {
  private readonly used = new Set<string>();
  private readonly ambiguous = new Set<string>();
  private readonly aboveLimit = new Set<string>();
  readonly matchedPairs: MatchedPair[] = [];
  identityApiCallCount = 0;
  private limitApplied = false;
  constructor(private readonly bank: Transaction[], private readonly tbs: Transaction[]) {}

  matchByKey(rule: string, bankEligible: (tx: Transaction) => boolean, tbsEligible: (tx: Transaction) => boolean,
             bankKey: (tx: Transaction) => string | null, tbsKey: (tx: Transaction) => string | null): void {
    if (this.limitApplied) throw new Error('Deterministic rules must run before the amount limit');
    const group = (source: Transaction[], eligible: (tx: Transaction) => boolean,
                   extractor: (tx: Transaction) => string | null): Map<string, Transaction[]> => {
      const output = new Map<string, Transaction[]>();
      for (const tx of source) {
        if (this.used.has(position(tx)) || !eligible(tx)) continue;
        const id = extractor(tx)?.trim().toUpperCase();
        if (!id) continue;
        const k = `${id.length}:${id}|${tx.amountRials.toString()}`;
        const list = output.get(k) ?? [];
        list.push(tx); output.set(k, list);
      }
      return output;
    };
    const left = group(this.bank, bankEligible, bankKey), right = group(this.tbs, tbsEligible, tbsKey);
    for (const [key, bankItems] of left) {
      const tbsItems = right.get(key);
      if (!tbsItems?.length) continue;
      if (bankItems.length !== tbsItems.length) {
        for (const tx of [...bankItems, ...tbsItems]) this.ambiguous.add(position(tx));
        continue;
      }
      const evidence = bankItems.length === 1 ? rule : `${rule}_GROUP_NON_UNIQUE`;
      for (let i = 0; i < bankItems.length; i++) {
        const b = bankItems[i]!, t = tbsItems[i]!;
        if (this.used.has(position(b)) || this.used.has(position(t))) throw new Error('Transaction consumed twice');
        this.used.add(position(b)); this.used.add(position(t));
        this.matchedPairs.push({ bank: b, tbs: t, evidence });
      }
    }
  }

  /** The net amount difference cannot prune two-sided unresolved candidates. */
  applyAmountDifferenceLimit(limit: bigint): void {
    if (limit < 0n || this.limitApplied) throw new Error('Invalid/duplicate amount difference limit');
    this.limitApplied = true;
    const left = this.remaining(this.bank), right = this.remaining(this.tbs);
    if (left.length && right.length) return;
    for (const tx of [...left, ...right]) if (tx.amountRials > limit) this.aboveLimit.add(position(tx));
  }

  /** Optional surname matching. Ambiguous many-to-many candidates remain unresolved. */
  async resolveByLastName(provider?: IdentityInquiryPort | null): Promise<void> {
    if (!this.limitApplied) throw new Error('Apply amount limit before identity matching');
    if (!provider) return;
    const tbsByAmount = new Map<bigint, Transaction[]>();
    for (const tx of this.remaining(this.tbs)) {
      if (this.aboveLimit.has(position(tx)) || tx.type === Type.REVERSAL || !tx.depositorName?.trim()) continue;
      const list = tbsByAmount.get(tx.amountRials) ?? [];
      list.push(tx); tbsByAmount.set(tx.amountRials, list);
    }
    const cache = new Map<string, string | null>();
    const candidates = new Map<string, Set<string>>();
    const bankPos = new Map<string, Transaction>(), tbsPos = new Map<string, Transaction>();
    for (const b of this.remaining(this.bank)) {
      if (this.aboveLimit.has(position(b)) || b.type === Type.REVERSAL || !b.nationalId) continue;
      const options = tbsByAmount.get(b.amountRials);
      if (!options?.length) continue;
      if (!cache.has(b.nationalId)) {
        this.identityApiCallCount++;
        try { cache.set(b.nationalId, await provider.findLastName(b.nationalId) ?? null); }
        catch { cache.set(b.nationalId, null); }
      }
      const lastName = cache.get(b.nationalId);
      if (!lastName?.trim()) continue;
      bankPos.set(position(b), b);
      for (const t of options) {
        if (!sameLastName(t.depositorName!, lastName)) continue;
        const key = position(t); tbsPos.set(key, t);
        const group = candidates.get(position(b)) ?? new Set<string>();
        group.add(key); candidates.set(position(b), group);
      }
    }
    let changed: boolean;
    do {
      changed = false;
      const tbsCounts = new Map<string, number>();
      for (const [bp, values] of candidates) if (!this.used.has(bp))
        for (const tp of values) if (!this.used.has(tp)) tbsCounts.set(tp, (tbsCounts.get(tp) ?? 0) + 1);
      for (const [bp, values] of candidates) {
        if (this.used.has(bp)) continue;
        const remaining = [...values].filter(p => !this.used.has(p));
        if (remaining.length !== 1 || tbsCounts.get(remaining[0]!) !== 1) continue;
        const tp = remaining[0]!;
        this.used.add(bp); this.used.add(tp);
        this.matchedPairs.push({ bank: bankPos.get(bp)!, tbs: tbsPos.get(tp)!, evidence: 'IDENTITY_LAST_NAME_AND_AMOUNT' });
        changed = true;
      }
    } while (changed);
    for (const [bp, values] of candidates) {
      if (this.used.has(bp)) continue;
      for (const tp of values) if (!this.used.has(tp)) { this.ambiguous.add(bp); this.ambiguous.add(tp); }
    }
  }

  private remaining(list: Transaction[]): Transaction[] { return list.filter(t => !this.used.has(position(t))); }
  outcome(): { bankOnly: Transaction[]; tbsOnly: Transaction[]; unresolved: Transaction[] } {
    const bank = this.remaining(this.bank), tbs = this.remaining(this.tbs);
    const bankOnly: Transaction[] = [], tbsOnly: Transaction[] = [], unresolved: Transaction[] = [];
    for (const tx of bank) {
      if (!tbs.length && !this.ambiguous.has(position(tx)) && !this.aboveLimit.has(position(tx))) bankOnly.push(tx);
      else unresolved.push(tx);
    }
    for (const tx of tbs) {
      if (!bank.length && !this.ambiguous.has(position(tx)) && !this.aboveLimit.has(position(tx))) tbsOnly.push(tx);
      else unresolved.push(tx);
    }
    return { bankOnly, tbsOnly, unresolved };
  }
  classify(): Discrepancy[] {
    const { bankOnly, tbsOnly, unresolved } = this.outcome();
    const output: Discrepancy[] = [];
    for (const tx of bankOnly) output.push({ type: DiscrepancyType.BANK_ONLY, transaction: tx,
      reasonCode: 'NO_TBS_COUNTERPART', explanation: 'Remaining bank row after all TBS rows were conclusively matched' });
    for (const tx of tbsOnly) output.push({ type: DiscrepancyType.TBS_ONLY, transaction: tx,
      reasonCode: 'NO_BANK_COUNTERPART', explanation: 'Remaining TBS row after all bank rows were conclusively matched' });
    for (const tx of unresolved) {
      const p = position(tx);
      const reasonCode = this.ambiguous.has(p) ? 'AMBIGUOUS_DUPLICATE_GROUP'
        : this.aboveLimit.has(p) ? 'ABOVE_AGGREGATE_AMOUNT_DIFFERENCE_LIMIT' : 'INSUFFICIENT_EVIDENCE';
      const explanation = reasonCode === 'AMBIGUOUS_DUPLICATE_GROUP'
        ? 'Duplicate group is ambiguous; exact physical row cannot be proven'
        : reasonCode === 'ABOVE_AGGREGATE_AMOUNT_DIFFERENCE_LIMIT'
          ? 'Amount exceeds aggregate difference; identity investigation skipped'
          : 'Cannot identify a specific unmatched physical Excel row with available rules';
      output.push({ type: DiscrepancyType.UNRESOLVED, transaction: tx, reasonCode, explanation });
    }
    return output;
  }
}
function nameKey(text: string): string {
  return text.normalize('NFKC').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ')
    .replace(/[\u064B-\u065F]/g, '').replace(/\s+/g, ' ').trim();
}
function sameLastName(name: string, last: string): boolean {
  const full = nameKey(name), surname = nameKey(last);
  return Boolean(surname) && (full === surname || full.endsWith(` ${surname}`));
}
