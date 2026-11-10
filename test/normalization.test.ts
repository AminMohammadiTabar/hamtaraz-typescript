import test from 'node:test'; import assert from 'node:assert/strict';
import { Source, Type } from '../src/domain/models.ts';
import { bankTrackingSuffix, canonical, normalize, parseDate, toTenDigitNationalId,wholeRials } from '../src/normalization/normalizer.ts';
import type { RawExcelRow } from '../src/domain/models.ts';
const bank=(columns:Record<string,string>):RawExcelRow=>({source:Source.BANK,sheetName:'صورتحساب1',excelRowNumber:9,
  columns:{'تاریخ':'1405/08/05','مبلغ واریز (ریال)':'1000',...columns}});
const tbs=(narration:string,documentType='واریز وجه از مفید کارت ملی'):RawExcelRow=>({source:Source.TBS,sheetName:'Page 1',excelRowNumber:10,
  columns:{'تاریخ سند':'1405/08/05','بدهکار':'1000','شرح ردیف سند':narration,'نوع سند':documentType}});
test('exact monetary parse supports exponential forms without loss of scale',()=>{
 assert.equal(wholeRials('1.0E+6'),1000000n);
 assert.equal(wholeRials('۱٬۲۳۴٬۵۶۷'),1234567n);
 assert.throws(()=>wholeRials('1.25'),/whole rial/);
 assert.equal(wholeRials('0',true),0n);
});
test('canonical Persian/Arabic digits and Arabic letters',()=>{
 assert.equal(canonical('  ٠١۲۳ ي ك  '),'0123 ی ک');
});
test('national ID pads leading zeros without changing source',()=>{
 assert.equal(toTenDigitNationalId('4611797570'),'4611797570');
 assert.equal(toTenDigitNationalId('672859696'),'0672859696');
 assert.equal(toTenDigitNationalId('12345678'),'0012345678');
 assert.throws(()=>toTenDigitNationalId('1234567'));
});
test('MC swaps between description and extra description',()=>{
 const a=normalize(bank({'توضیحات':'0390067023007','توضیحات اضافی':'MC4611797570'}));
 const b=normalize(bank({'توضیحات':'MC4611797570','توضیحات اضافی':'0390067023007'}));
 assert.equal(a.nationalId,b.nationalId);assert.equal(a.accountNumber,b.accountNumber);
 assert.equal(a.type,Type.UNKNOWN);
});
test('reversed MC recognized as reversal',()=>{
 const tx=normalize(bank({'توضیحات':'MC4611797570 - reversed','توضیحات اضافی':'0390067023007'}));
 assert.equal(tx.type,Type.REVERSAL);
});
test('19-digit bank identifier is NOT card PAN or automatically Mofid-issued',()=>{
 const tx=normalize(bank({'توضیحات':'1793050268937915007','توضیحات اضافی':'0390067023007'}));
 assert.equal(tx.bankExternalTransactionId,'1793050268937915007');
 assert.equal(tx.mofidTransactionId,null);
});
test('Mofid-issued ID is extracted only from explicit TBS narration',()=>{
 const tx=normalize(tbs('دریافت طی مفید کارت به شماره 1793050268937915007 واریز کننده : رضا پرندافشار @@ | شناسه مرجع: 14050805010001bcgf1098 | شناسه پیگیری: bcg12232'));
 assert.equal(tx.mofidTransactionId,'1793050268937915007');
 assert.equal(tx.bankExternalTransactionId,null);
 assert.equal(tx.depositorName,'رضا پرندافشار');
 assert.equal(tx.referenceId,'14050805010001BCGF1098');
});
test('reject 20-digit labeled Mofid ID instead of truncating',()=>{
 assert.throws(()=>normalize(tbs('دریافت طی مفید کارت به شماره 17930502689379150070 واریز کننده : علی @@')),/Mofid ID/);
});
test('bank tracking suffix matches only end of TBS reference',()=>{
 assert.equal(bankTrackingSuffix('14050805010001bcgf1098'),'BCGF1098');
 assert.equal(bankTrackingSuffix('prefix-bcgf1098-more'),null);
});
test('valid and invalid Persian date checks',()=>{
 assert.equal(parseDate('1405/08/05'),'2026-10-27');
 assert.throws(()=>parseDate('1405/13/05'));
 assert.throws(()=>parseDate('1405/12/31'));
});
