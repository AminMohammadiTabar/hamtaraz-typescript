import test from 'node:test';
import assert from 'node:assert/strict';
import {ReconciliationEngine} from '../src/domain/engine.ts';
import { summarize } from '../src/domain/aggregate.ts';
import { Mode, Source, Status, DiscrepancyType, Type } from '../src/domain/models.ts';
import { tx } from './helpers.ts';

test('aggregate equality short-circuits both modes', async () => {
  for(const mode of [Mode.STANDARD,Mode.ENHANCED]) {
    const result=await new ReconciliationEngine({findLastName:async()=>{throw new Error('Should never call')}})
      .reconcile([tx(Source.BANK,9,1000n)],[tx(Source.TBS,8,1000n)],mode);
    assert.equal(result.status,Status.BALANCED);
    assert.equal(result.matchedPairs.length,0);
    assert.equal(result.identityApiCallCount,0);
  }
});
test('same counts but different totals require detail phase',async()=>{
  const r=await new ReconciliationEngine().reconcile([tx(Source.BANK,9,1000n)],[tx(Source.TBS,8,900n)],Mode.ENHANCED);
  assert.equal(r.status,Status.REVIEW);
  assert.equal(r.discrepancies.length,2);
});
test('duplicate physical Excel rows rejected',()=>{
  assert.throws(()=>summarize([tx(Source.BANK,9,1n),tx(Source.BANK,9,2n)],[]),/Duplicate/);
});
test('cross-source contamination rejected',()=>{
  assert.throws(()=>summarize([tx(Source.TBS,9,1n)],[]),/Unexpected/);
});
test('standard explicit ID + amount matches regardless of BigDecimal string scale',async()=>{
  const id='1793050268937915007';
  const b=[tx(Source.BANK,9,1000000n,{bankExternalTransactionId:id}),tx(Source.BANK,10,500n)];
  const t=[tx(Source.TBS,8,1000000n,{mofidTransactionId:id})];
  const r=await new ReconciliationEngine().reconcile(b,t,Mode.STANDARD);
  assert.deepEqual(r.discrepancies.filter(x=>x.type===DiscrepancyType.BANK_ONLY).map(x=>x.transaction.excelRowNumber),[10]);
  assert.equal(r.matchedPairs.length,1);
});
test('enhanced reference suffix only matches applicable document type',async()=>{
  const b=[tx(Source.BANK,9,1000000n,{nationalId:'0461179757',trackingNumber:'BCGC3102'}),tx(Source.BANK,10,500n)];
  const t=[tx(Source.TBS,8,1000000n,{referenceId:'14050805010001bcgc3102',rawColumns:{'نوع سند':'واریز وجه از مفید کارت ملی'}})];
  const r=await new ReconciliationEngine().reconcile(b,t,Mode.ENHANCED);
  assert.equal(r.matchedPairs[0]?.evidence,'TBS_REFERENCE_SUFFIX_BANK_TRACKING');
  assert.deepEqual(r.discrepancies.filter(d=>d.type==='BANK_ONLY').map(d=>d.transaction.excelRowNumber),[10]);
});
test('reversals match by national ID only in enhanced mode and correct document family',async()=>{
  const b=[tx(Source.BANK,9,700n,{nationalId:'0461179757',type:Type.REVERSAL}),tx(Source.BANK,10,10n)];
  const t=[tx(Source.TBS,8,700n,{nationalId:'0461179757',type:Type.REVERSAL,rawColumns:{'نوع سند':'اصلاح مفید کارت ملی'}})];
  const r=await new ReconciliationEngine().reconcile(b,t,Mode.ENHANCED);
  assert.equal(r.matchedPairs[0]?.evidence,'MC_REVERSAL_NATIONAL_ID_AND_AMOUNT');
  assert.equal(r.discrepancies.filter(d=>d.type==='BANK_ONLY').length,1);
});
test('special tracking in TBS can match bank 19-digit field',async()=>{
  const id='1793050268937915007';
  const b=[tx(Source.BANK,9,200040000n,{bankExternalTransactionId:id}),tx(Source.BANK,10,20n)];
  const t=[tx(Source.TBS,8,200040000n,{trackingNumber:id,rawColumns:{'نوع سند':'اصلاحیه مسدودی برداشت حسابی'}})];
  const r=await new ReconciliationEngine().reconcile(b,t,Mode.ENHANCED);
  assert.equal(r.matchedPairs[0]?.evidence,'SPECIAL_TBS_TRACKING_BANK_EXTERNAL_ID');
});
test('unequal duplicate-key groups are not assigned to an arbitrary physical row',async()=>{
  const id='1793050268937915007';
  const b=[tx(Source.BANK,9,100n,{bankExternalTransactionId:id}),tx(Source.BANK,10,100n,{bankExternalTransactionId:id})];
  const t=[tx(Source.TBS,8,100n,{mofidTransactionId:id})];
  const r=await new ReconciliationEngine().reconcile(b,t,Mode.STANDARD);
  assert.equal(r.matchedPairs.length,0);
  assert.equal(r.discrepancies.filter(d=>d.reasonCode==='AMBIGUOUS_DUPLICATE_GROUP').length,3);
});
test('equal duplicate-key groups are matched as non-unique groups',async()=>{
  const id='1793050268937915007';
  const b=[tx(Source.BANK,9,100n,{bankExternalTransactionId:id}),tx(Source.BANK,10,100n,{bankExternalTransactionId:id}),tx(Source.BANK,11,1n)];
  const t=[tx(Source.TBS,8,100n,{mofidTransactionId:id}),tx(Source.TBS,9,100n,{mofidTransactionId:id})];
  const r=await new ReconciliationEngine().reconcile(b,t,Mode.STANDARD);
  assert.equal(r.matchedPairs.length,2);
  assert.ok(r.matchedPairs.every(p=>p.evidence.endsWith('_GROUP_NON_UNIQUE')));
});
test('net-delta cannot filter large two-sided identity candidates',async()=>{
  const b=[tx(Source.BANK,9,1000000n,{nationalId:'0461179757'}),tx(Source.BANK,10,500n,{nationalId:'0672859696'})];
  const t=[tx(Source.TBS,8,1000000n,{depositorName:'علی احمدی'})];
  let calls=0;
  const r=await new ReconciliationEngine({findLastName:async id=>{calls++;return id==='0461179757'?'احمدی':null;}})
    .reconcile(b,t,Mode.STANDARD);
  assert.equal(calls,1);assert.equal(r.identityApiCallCount,1);
  assert.deepEqual(r.discrepancies.filter(d=>d.type==='BANK_ONLY').map(d=>d.transaction.excelRowNumber),[10]);
});
test('identity API failure leaves ambiguous rows unresolved rather than asserting false difference',async()=>{
  const b=[tx(Source.BANK,9,1000n,{nationalId:'0461179757'}),tx(Source.BANK,10,1n)];
  const t=[tx(Source.TBS,8,1000n,{depositorName:'علی احمدی'})];
  const r=await new ReconciliationEngine({findLastName:async()=>{throw new Error('503')}}).reconcile(b,t,Mode.STANDARD);
  assert.equal(r.status, Status.REVIEW);assert.equal(r.identityApiCallCount,1);
});
