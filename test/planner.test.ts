import test from 'node:test'; import assert from 'node:assert/strict';
import { ReconciliationService,planIdentityLookups } from '../src/application/reconciliation-service.ts';
import { Mode,Source,Status } from '../src/domain/models.ts';
import { tx } from './helpers.ts';
test('v1.0.1 regression: planner must count large same-amount two-sided unresolved cases',async()=>{
 const b=[tx(Source.BANK,9,1000000n,{nationalId:'0461179757'}),tx(Source.BANK,10,500n,{nationalId:'0672859696'})];
 const t=[tx(Source.TBS,8,1000000n,{depositorName:'علی احمدی'})];
 const service = new ReconciliationService();
 const prepared = await service.prepareTransactions(b,t,Mode.STANDARD);
 assert.equal(prepared.lookupCount,1);assert.deepEqual(prepared.plannedNationalIds,['0461179757']);
 assert.equal(prepared.localRun.result.identityApiCallCount,0);
 let calls=0;
 const after=await service.finishWithIdentity(prepared,{findLastName:async()=>{calls++;return 'احمدی';}});
 assert.equal(calls,1);assert.equal(after.result.identityApiCallCount,1);
 assert.deepEqual(after.result.discrepancies.filter(x=>x.type==='BANK_ONLY').map(x=>x.transaction.excelRowNumber),[10]);
});
test('balanced aggregate never plans identity calls',async()=>{
 const p=await new ReconciliationService().prepareTransactions([tx(Source.BANK,9,1000n)],[tx(Source.TBS,8,1000n)],Mode.STANDARD);
 assert.equal(p.lookupCount,0);assert.equal(p.localRun.result.status,Status.BALANCED);
});
test('planner deduplicates same national ID',async()=>{
 const b=[tx(Source.BANK,9,1000n,{nationalId:'0461179757'}),tx(Source.BANK,10,2000n,{nationalId:'0461179757'}),tx(Source.BANK,11,5n)];
 const t=[tx(Source.TBS,8,1000n,{depositorName:'علی احمدی'}),tx(Source.TBS,9,2000n,{depositorName:'علی احمدی'})];
 const p=await new ReconciliationService().prepareTransactions(b,t,Mode.STANDARD);
 assert.deepEqual(p.plannedNationalIds,['0461179757']);
});
