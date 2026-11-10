import { Source, Type } from '../src/domain/models.ts';
import type { Transaction, TransactionSource, TransactionType } from '../src/domain/models.ts';
export function tx(source: TransactionSource, row: number, amount: bigint | string, fields: Partial<Transaction> = {}): Transaction {
  return { source, sheetName: source === Source.BANK ? 'صورت‌حساب1' : 'Page 1',
    excelRowNumber:row,date:'2026-10-27',amountRials:BigInt(amount),trackingNumber:null,referenceId:null,
    mofidTransactionId:null,bankExternalTransactionId:null,nationalId:null,accountNumber:null,
    depositorName:null,type:Type.UNKNOWN,rawColumns:{},...fields };
}
