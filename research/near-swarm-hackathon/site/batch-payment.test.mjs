import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runBatchPayment} from './batch-payment.mjs';

test('one message plus one wallet batch, durable save before sequential automatic execution',async()=>{
 const events=[];let auth=0,signs=0;
 const result=await runBatchPayment({authorize:async action=>{assert.equal(action,'wallet-run');auth++;return {expires:Date.now()+100000};},
  request:async b=>{events.push(b.operation+(b.step??''));if(b.operation==='prepare')return {items:[{confirmed:true},{bytes:'two'},{bytes:'three'}]};if(b.operation==='stage'){assert.deepEqual(b.signedTransactions,[{step:1,bytes:'signed-two'},{step:2,bytes:'signed-three'}]);return {status:'batch-stored'};}return {status:b.step===3?'submitted':'step-confirmed'};},
  signAll:async bytes=>{signs++;return bytes.map(b=>'signed-'+b);}});
 assert.equal(auth,1);assert.equal(signs,1);assert.deepEqual(events,['prepare','stage','step1','step2','step3']);assert.equal(result.status,'submitted');
});
test('lost staging response resumes durable signatures without a second signing request',async()=>{
 let staged=false,landed=false,signs=0;
 const deps={authorize:async()=>({expires:Date.now()+100000}),signAll:async()=>{signs++;return ['signed'];},request:async b=>{
  if(b.operation==='prepare')return {items:[landed?{confirmed:true}:staged?{pending:true}:{bytes:'unsigned'}]};
  if(b.operation==='stage'){staged=true;throw Error('response lost');}
  if(b.step===0){landed=true;return {status:'step-confirmed'};}return {status:'submitted'};
 }};
 await assert.rejects(()=>runBatchPayment(deps),/response lost/);
 assert.equal((await runBatchPayment(deps)).status,'submitted');assert.equal(signs,1);
});
test('wallet rejection and malformed batch do not stage or execute any transaction',async()=>{
 for(const signAll of [async()=>{throw Error('declined');},async()=>[]]){
 const operations=[];
 await assert.rejects(()=>runBatchPayment({authorize:async()=>({expires:Date.now()+100000}),signAll,
 request:async b=>{operations.push(b.operation);return {items:[{bytes:'unsigned'}]};}}));
 assert.deepEqual(operations,['prepare']);
 }
});
test('a failed earlier step prevents every later step and does not ask for another signature',async()=>{
 const steps=[];let signs=0;
 await assert.rejects(()=>runBatchPayment({authorize:async()=>({expires:Date.now()+100000}),
 signAll:async()=>{signs++;return ['one','two'];},request:async b=>{
 if(b.operation==='prepare')return {items:[{bytes:'one'},{bytes:'two'}]};if(b.operation==='stage')return {status:'batch-stored'};
 steps.push(b.step);throw Error('simulation rejected');}}),/simulation rejected/);
 assert.equal(signs,1);assert.deepEqual(steps,[0]);
});
