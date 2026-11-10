import test from 'node:test'; import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { Mode, DiscrepancyType } from '../src/domain/models.ts';
import { ReconciliationService } from '../src/application/reconciliation-service.ts';
import { writeReport } from '../src/infrastructure/excel/report-writer.ts';
import { createHamtarazServer } from '../src/web/server.ts';

let exceljsInstalled = false, mustacheInstalled = false;
try {
  // @ts-ignore -- optional until npm install
  await import('exceljs'); exceljsInstalled = true;
} catch {}
try {
  // @ts-ignore -- optional until npm install
  await import('mustache'); mustacheInstalled = true;
} catch {}

async function workbooks(): Promise<{ bank: Buffer; tbs: Buffer }> {
  // @ts-ignore -- install via npm
  const { default: ExcelJS } = await import('exceljs');
  const bank=new ExcelJS.Workbook();
  const b=bank.addWorksheet('صورتحساب1');
  b.addRow(['تاریخ','مبلغ واریز (ریال)','مبلغ برداشت (ریال)','شماره پیگیری','توضیحات','توضیحات اضافی']);
  b.addRow(['1405/08/05',1000000,'-','BCGA1001','1793050268937915007','0390067023007']);
  b.addRow(['1405/08/05',500,'-','BCGA1002','0390067023007','MC4611797570']);
  const tbs=new ExcelJS.Workbook();
  const t=tbs.addWorksheet('Page 1');
  t.addRow(['کد حساب','نام حساب','تاریخ سند','شماره سند','نوع سند','شرح ردیف سند','بدهکار','بستانکار']);
  t.addRow(['11001-4000087','ملی, بورس - 0118837982001','1405/08/05',2545,'انتقال وجه واسط بانک ملی',
    'انتقال وجه مربوط به علی احمدی به شناسه ملی 0461179757 | شناسه تراکنش: 1793050268937915007',1000000,0]);
  return {bank: Buffer.from(await bank.xlsx.writeBuffer()),tbs: Buffer.from(await tbs.xlsx.writeBuffer())};
}
test('integration: XLSX parse -> normalize -> enhanced matching -> 4-sheet report', {skip: !exceljsInstalled}, async()=>{
 const {bank,tbs}=await workbooks();
 const prepared=await new ReconciliationService().prepare(bank,tbs,Mode.ENHANCED);
 assert.equal(prepared.localRun.result.matchedPairs.length,1);
 const bankOnly=prepared.localRun.result.discrepancies.filter(d=>d.type===DiscrepancyType.BANK_ONLY);
 assert.deepEqual(bankOnly.map(d=>d.transaction.excelRowNumber),[3]);
 assert.equal(prepared.localRun.result.summary.amountDifferenceRials,500n);
 const output=await writeReport(prepared.localRun.result);
 // @ts-ignore -- ExcelJS installed by npm
 const {default: ExcelJS}=await import('exceljs');
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(output);
 assert.deepEqual(workbook.worksheets.map((w:{name:string})=>w.name),['Summary','Bank Only','TBS Only','Unresolved']);
});
test('integration: public v1 web upload enforces enhanced, hides API/settings, and downloads XLSX',
 {skip: !exceljsInstalled || !mustacheInstalled}, async()=>{
 const server=createHamtarazServer();
 await new Promise<void>(done=>server.listen(0,done));
 const address=server.address();if(!address || typeof address==='string') throw new Error('No assigned port');
 const origin=`http://127.0.0.1:${address.port}`;
 try {
  const home=await fetch(origin);
  assert.equal(home.status,200);
  const page=await home.text();
  assert.ok(!page.includes('href="/settings"'));
  assert.ok(!page.includes('name="mode"'));
  const csrf=page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1]; assert.ok(csrf);
  const cookie=home.headers.get('set-cookie')!.split(';')[0]!;
  const {bank,tbs}=await workbooks();
  const form=new FormData();form.set('csrf',csrf);
  form.set('mode','STANDARD'); // attacker tries to select hidden mode
  form.set('bankFile',new Blob([bank],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'bank.xlsx');
  form.set('tbsFile',new Blob([tbs],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'tbs.xlsx');
  const upload=await fetch(origin+'/reconcile',{method:'POST',body:form,headers:{cookie},redirect:'manual'});
  assert.equal(upload.status,303);
  const results=await fetch(origin+'/results',{headers:{cookie}});
  const html=await results.text(); assert.ok(html.includes('۵۰۰') || html.includes('500'));
  assert.ok(html.includes('فقط در بانک'));
  assert.equal((await fetch(origin+'/settings',{headers:{cookie}})).status,404);
  const dl=await fetch(origin+'/results/download',{headers:{cookie}});
  assert.equal(dl.status,200); assert.equal(dl.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 } finally {await new Promise<void>((ok,err)=>server.close(e=>e?err(e):ok()));}
});
test('golden: original real Excel files (only if paths provided)',
 {skip:!exceljsInstalled || !process.env.GOLDEN_BANK || !process.env.GOLDEN_TBS},async()=>{
 const prepared=await new ReconciliationService().prepare(await readFile(process.env.GOLDEN_BANK!),
  await readFile(process.env.GOLDEN_TBS!),Mode.ENHANCED);
 const r=prepared.localRun.result;
 assert.equal(r.summary.bankCount,15281);assert.equal(r.summary.tbsCount,15278);
 assert.equal(r.summary.amountDifferenceRials,24199900n);
 assert.deepEqual(r.discrepancies.filter(d=>d.type===DiscrepancyType.BANK_ONLY)
  .map(d=>d.transaction.excelRowNumber).sort((a,b)=>a-b),[5464,10125,10403]);
 assert.equal(r.discrepancies.filter(d=>d.type===DiscrepancyType.TBS_ONLY).length,0);
 assert.equal(r.discrepancies.filter(d=>d.type===DiscrepancyType.UNRESOLVED).length,0);
});


test('integration: local B Lotus font diagnostics match the static font response', async () => {
 const server=createHamtarazServer();
 await new Promise<void>(done=>server.listen(0,done));
 const address=server.address();if(!address || typeof address==='string') throw new Error('No assigned port');
 const origin=`http://127.0.0.1:${address.port}`;
 try {
  const statusResponse=await fetch(origin+'/diagnostics/font');
  assert.equal(statusResponse.status,200);
  const status=await statusResponse.json() as {available:boolean;bytes?:number;validSfntSignature?:boolean;url:string};
  assert.equal(status.url,'/assets/fonts/BLOTUS.TTF');
  const fontResponse=await fetch(origin+'/assets/fonts/BLOTUS.TTF');
  if (status.available) {
   assert.equal(status.validSfntSignature,true);
   assert.equal(fontResponse.status,200);
   assert.equal(fontResponse.headers.get('content-type'),'font/ttf');
   assert.equal(Number(fontResponse.headers.get('content-length')),status.bytes);
  } else {
   assert.equal(fontResponse.status,404);
  }
 } finally {await new Promise<void>((ok,err)=>server.close(e=>e?err(e):ok()));}
});
