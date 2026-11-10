// Development-only cross-language verification against temporary Python-extracted JSON.
// These JSON files include private banking data and are deliberately NOT distributed.
import {readFile} from 'node:fs/promises';
import {normalizeAll} from '../src/normalization/normalizer.ts';
import {ReconciliationEngine} from '../src/domain/engine.ts';
import {Mode,DiscrepancyType} from '../src/domain/models.ts';
import type {RawExcelRow} from '../src/domain/models.ts';
const root = process.argv[2];
if (!root) throw new Error('Usage: node ... check-golden-json.ts <temporary data directory>');
const bank=normalizeAll(JSON.parse(await readFile(`${root}/gold-bank.json`,'utf8')) as RawExcelRow[]);
const tbs=normalizeAll(JSON.parse(await readFile(`${root}/gold-tbs.json`,'utf8')) as RawExcelRow[]);
for(const mode of [Mode.STANDARD,Mode.ENHANCED]) {
 const r=await new ReconciliationEngine().reconcile(bank,tbs,mode);
 const b=r.discrepancies.filter(d=>d.type===DiscrepancyType.BANK_ONLY).map(d=>d.transaction.excelRowNumber);
 console.log(JSON.stringify({mode,bankCount:r.summary.bankCount,tbsCount:r.summary.tbsCount,
  delta:String(r.summary.amountDifferenceRials),matchedPairs:r.matchedPairs.length,
  bankOnly:b,tbsOnly:r.discrepancies.filter(d=>d.type==='TBS_ONLY').length,
  unresolved:r.discrepancies.filter(d=>d.type==='UNRESOLVED').length}));
}
