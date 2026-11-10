import type { ReconciliationResult, Transaction } from '../../domain/models.ts';
import { DiscrepancyType } from '../../domain/models.ts';

/** Always write Excel STRING cells and neutralize formula-like user-provided text. */
export function safeExcelText(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const clipped = text.length > 32000 ? text.slice(0, 32000) : text;
  return clipped && '=+-@\t\r'.includes(clipped[0]!) ? `'${clipped}` : clipped;
}
const detailsHeaders = ['Source','Sheet','Excel row','Date','Amount (IRR)','Tracking number',
  'Bank external ID','Mofid transaction ID','National ID','Account number','Depositor','Transaction type','Reason code','Reason'];

/** Generates the same four-sheet XLSX report as the Java Apache POI adapter. */
export async function writeReport(result: ReconciliationResult): Promise<Buffer> {
  // @ts-ignore -- ExcelJS installed by npm at runtime
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const summary = book.addWorksheet('Summary');
  const s = result.summary;
  const data: Array<[string, string]> = [
    ['Field','Value'],['Mode',result.mode],['Status',result.status],['Bank count',String(s.bankCount)],
    ['TBS count',String(s.tbsCount)],['Count difference',String(s.countDifference)],
    ['Bank amount (IRR)',String(s.bankTotalRials)],['TBS amount (IRR)',String(s.tbsTotalRials)],
    ['Amount difference (IRR)',String(s.amountDifferenceRials)],['Identity API calls',String(result.identityApiCallCount)],
    ['Bank-only rows', String(result.discrepancies.filter(x=>x.type === DiscrepancyType.BANK_ONLY).length)],
    ['TBS-only rows', String(result.discrepancies.filter(x=>x.type === DiscrepancyType.TBS_ONLY).length)],
    ['Unresolved rows', String(result.discrepancies.filter(x=>x.type === DiscrepancyType.UNRESOLVED).length)],
    ['Important','Aggregate balance does NOT mean row-by-row verification'] ];
  for (const [a,b] of data) summary.addRow([safeExcelText(a),safeExcelText(b)]);
  summary.columns = [{ width: 35 }, { width: 83 }];
  for (const [sheetName, type] of [['Bank Only',DiscrepancyType.BANK_ONLY],['TBS Only',DiscrepancyType.TBS_ONLY],['Unresolved',DiscrepancyType.UNRESOLVED]] as const) {
    const sheet = book.addWorksheet(sheetName);
    sheet.addRow(detailsHeaders);
    for (const d of result.discrepancies.filter(x => x.type === type)) {
      const t: Transaction = d.transaction;
      const values: unknown[] = [t.source,t.sheetName,t.excelRowNumber,t.date,t.amountRials,t.trackingNumber,
        t.bankExternalTransactionId,t.mofidTransactionId,t.nationalId,t.accountNumber,t.depositorName,
        t.type,d.reasonCode,d.explanation];
      sheet.addRow(values.map(safeExcelText));
    }
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF19667A' } };
    sheet.columns = detailsHeaders.map(h => ({ width: Math.min(38,Math.max(16,h.length + 4)) }));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (sheet.rowCount > 1) sheet.autoFilter = { from: {row:1,column:1}, to: {row:sheet.rowCount,column:detailsHeaders.length} };
  }
  summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF19667A' } };
  summary.views = [{ state: 'frozen', ySplit: 1 }];
  const bytes = await book.xlsx.writeBuffer();
  return Buffer.from(bytes);
}
