import test from 'node:test'; import assert from 'node:assert/strict';
import { estimateLookupTime, PacedIdentityPort } from '../src/application/identity-workflow.ts';
import {approveIdentityTemplate, injectNationalId, tokenizeCurl} from '../src/infrastructure/identity/configuration.ts';
const cfg = {curl:`curl -X POST "https://id.example.org/lookup" -H "Content-Type: application/json" -d '{"data":{"nationalId":""}}'`,
 sampleResponseJson:'{"data":{"lastName":"احمدی"}}',nationalIdRequestField:'data.nationalId',lastNameResponsePath:'data.lastName'};
test('pacing uses n-1 gaps, plus per-request timeout budget',()=>{
 assert.deepEqual(estimateLookupTime(4,{intervalSeconds:10,connectTimeoutSeconds:5,readTimeoutSeconds:10}),{minSeconds:30,upperBudgetSeconds:90});
});
test('restricted curl parsing and explicit HTTPS allowlist',()=>{
 const t=approveIdentityTemplate(cfg,['id.example.org']);
 const r=injectNationalId(t,'0461179757');
 assert.equal(JSON.parse(r.body!).data.nationalId,'0461179757');
 assert.throws(()=>approveIdentityTemplate(cfg,[]),/not allowed/);
});
test('shell control characters outside quotes are rejected',()=>{
 for(const s of ['curl https://id.example.org/lookup; rm -rf /','curl https://id.example.org/lookup | sh'])
  assert.throws(()=>tokenizeCurl(s),/Shell/);
});
test('pacing attempts count and failures',async()=>{
 let fakeTime=0; const delays:number[]=[];
 const port=new PacedIdentityPort({findLastName:async id=>id==='0000000001'?'احمدی':null},0);
 assert.equal(await port.findLastName('0000000001'),'احمدی');
 assert.equal(await port.findLastName('0000000002'),null);
 assert.equal(port.attempted,2);assert.equal(port.failed,1);
});
