import test from 'node:test'; import assert from 'node:assert/strict';
import {Source} from '../src/domain/models.ts';
import {parseWorkbook, ExcelParseError} from '../src/infrastructure/excel/parser.ts';
import {safeExcelText} from '../src/infrastructure/excel/report-writer.ts';
function workbook(rows: Array<Array<unknown>>) {
 return { worksheets:[{name:'Sheet 1',rowCount:rows.length,getRow(index:number){
  const a=rows[index-1]??[];
  return {cellCount:a.length,getCell(i:number){return {value:a[i-1]??null};}};
 }}]};
}
test('bank XLSX parser detects whitespace-wrapped header and retains physical row numbers',()=>{
 const cols=['ردیف',' تاریخ ','مبلغ واریز (ریال)','مبلغ برداشت (ریال)','شماره پیگیری','توضیحات','توضیحات اضافی'];
 const w=workbook([[],[],cols,['1','1405/08/05',1000000,'-', 'BCGF1098','0390067023007','MC4611797570'],['2','1405/08/05','-',100,'x','x','x']]);
 const p=parseWorkbook(w,Source.BANK);
 assert.equal(p.rows.length,1);assert.equal(p.rows[0]?.excelRowNumber,4);
 assert.equal(p.depositTotalRials,1000000n);assert.equal(p.excludedCounts.BANK_WITHDRAWAL,1);
});
test('formula cells rejected',()=>{
 const cols=['تاریخ','مبلغ واریز (ریال)','مبلغ برداشت (ریال)','شماره پیگیری','توضیحات','توضیحات اضافی'];
 const w=workbook([cols,['1405/08/05',{formula:'1+2'},'-','ABC','x','x']]);
 assert.throws(()=>parseWorkbook(w,Source.BANK),/Formula cells/);
});
test('unknown file layout rejected rather than guess headers',()=>{
 assert.throws(()=>parseWorkbook(workbook([['Hello','World']]),Source.TBS),/Missing required/);
});
test('report escapes formula-like raw cells',()=>{
 assert.equal(safeExcelText('=HYPERLINK("http://bad")'),"'=HYPERLINK(\"http://bad\")");
 assert.equal(safeExcelText('+10'),"'+10");
 assert.equal(safeExcelText('100'), '100');
});

test('TBS header row 6 with blank separator columns is parsed without false duplicate detection',()=>{
 const cols=['کد حساب','','نام حساب','شماره سند','تاریخ سند','نوع سند','شرح ردیف سند','بدهکار','بستانکار','مانده بدهکار','مانده بستانکار','مانده','کد مرکز هزینه','عنوان مرکز هزینه','','پیوست'];
 const w=workbook([
  [],[],[],[],[],cols,
  ['11001-4000087','','ملی, بورس - 0118837982001',-1,'1405/08/05','','مانده نقل از قبل',158227406220298,154678532354837],
  ['11001-4000087','','ملی, بورس - 0118837982001',2597,'1405/08/05','انتقال وجه بین بانکی','برداشت از 0118837982001',0,4510000000000],
  ['11001-4000087','','ملی, بورس - 0118837982001',2545,'1405/08/05','واریز وجه از مفید کارت ملی','دریافت طی مفید کارت به شماره 1793050268937915007 واریز کننده : علی احمدی @@',1000000,0]
 ]);
 const p=parseWorkbook(w,Source.TBS);
 assert.equal(p.rows.length,1);
 assert.equal(p.rows[0]?.excelRowNumber,9);
 assert.equal(p.depositTotalRials,1000000n);
 assert.equal(p.excludedCounts.TBS_OPENING_BALANCE,1);
 assert.equal(p.excludedCounts.TBS_ACCOUNT_WITHDRAWAL,1);
});
test('duplicate optional headers and unrelated large balances do not reject the report',()=>{
 const cols=['تاریخ','مبلغ واریز (ریال)','مبلغ برداشت (ریال)','شماره پیگیری','توضیحات','توضیحات اضافی','نام شعبه','نام شعبه','مانده (ریال)'];
 const w=workbook([cols,['1405/08/05',1000000,'-','BCGF1098','0390067023007','MC4611797570','شعبه الف','شعبه ب',Number.MAX_SAFE_INTEGER+1]]);
 const p=parseWorkbook(w,Source.BANK);
 assert.equal(p.rows.length,1);
 assert.equal(p.rows[0]?.columns['توضیحات اضافی'],'MC4611797570');
 assert.equal('مانده (ریال)' in p.rows[0]!.columns,false);
});
test('duplicate required headers fail with the exact header and column positions',()=>{
 const cols=['تاریخ','تاریخ','مبلغ واریز (ریال)','مبلغ برداشت (ریال)','شماره پیگیری','توضیحات','توضیحات اضافی'];
 const w=workbook([cols,['1405/08/05','1405/08/05',1000000,'-','BCGF1098','x','x']]);
 assert.throws(()=>parseWorkbook(w,Source.BANK),/تاریخ \(A and B\)/);
});

test('Bank header row 8 with report metadata above it is detected at the physical row',()=>{
 const cols=['ردیف','تاریخ','زمان','مبلغ واریز (ریال)','مبلغ برداشت (ریال)','مانده (ریال)','کد شعبه','نام شعبه','شماره پیگیری','شرح تراکنش','توضیحات','توضیحات اضافی','توضیحات کاربر','کانال'];
 const w=workbook([
  ['بانک ملی ایران'],['شماره حساب'],['از تاریخ'],['شرایط جستوجو'],['مانده موثر'],['مانده در دسترس'],[],cols,
  [1,'1405/08/05','22:55:07',133000000,'-',1140262073096,8893,'پرداخت لحظه ای','BCGC3102','انتقالي','0390194849002','MC1290794200','-','TELLER']
 ]);
 const p=parseWorkbook(w,Source.BANK);
 assert.equal(p.rows.length,1);
 assert.equal(p.rows[0]?.excelRowNumber,9);
 assert.equal(p.depositTotalRials,133000000n);
});


test('TBS parser ignores unsafe numeric values in non-business running-balance columns',()=>{
 const cols=['کد حساب','','نام حساب','شماره سند','تاریخ سند','نوع سند','شرح ردیف سند','بدهکار','بستانکار','مانده بدهکار','مانده بستانکار','مانده','کد مرکز هزینه','عنوان مرکز هزینه','','پیوست'];
 const row=['11001-4000087','','ملی, بورس - 0118837982001',2545,'1405/08/05','واریز وجه از مفید کارت ملی',
  'دریافت طی مفید کارت به شماره 1793050268937915007 واریز کننده : علی احمدی @@',1000000,0,
  Number.MAX_SAFE_INTEGER+1,Number.MAX_SAFE_INTEGER+2,Number.MAX_SAFE_INTEGER+3,'','','',''];
 const p=parseWorkbook(workbook([[],[],[],[],[],cols,row]),Source.TBS);
 assert.equal(p.rows.length,1);
 assert.equal(p.depositTotalRials,1000000n);
 assert.equal(p.rows[0]?.columns['بدهکار'],'1000000');
 assert.equal('مانده بستانکار' in p.rows[0]!.columns,false);
});

test('unsafe numeric values in required monetary columns are still rejected rather than rounded',()=>{
 const cols=['تاریخ','مبلغ واریز (ریال)','مبلغ برداشت (ریال)','شماره پیگیری','توضیحات','توضیحات اضافی'];
 const w=workbook([cols,['1405/08/05',Number.MAX_SAFE_INTEGER+1,'-','BCGF1098','x','x']]);
 assert.throws(()=>parseWorkbook(w,Source.BANK),(e: unknown)=>e instanceof ExcelParseError && e.code==='UNSAFE_NUMERIC_CELL' && e.message.includes("مبلغ واریز (ریال)' (B2)"));
});
