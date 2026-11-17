import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPayment} from './payment-runner.mjs';

test('authorizes first, refreshes each unsigned transaction and only polls an acknowledged broadcast',async()=>{
  const events=[],signs=[],submissions=[];let prepared=0,polls=0;
  const result=await runPayment({now:()=>1000,pause:async()=>{},
    authorize:async action=>{events.push(action);return {action,expires:50000};},
    prepare:async()=>{events.push('prepare');prepared++;return {items:prepared===1?[{bytes:'fresh-one'},{bytes:'old-two'}]:[{confirmed:true},{bytes:'fresh-two'}]};},
    sign:async bytes=>{signs.push(bytes);return 'signed-'+bytes;},
    submit:async(_,i,signed)=>{submissions.push({i,signed});if(i===2)return {status:'submitted'};if(i===0&&polls++===0)return {status:'confirming'};return {status:'step-confirmed'};}
  });
  assert.deepEqual(events.slice(0,3),['wallet-step','prepare-wallet','prepare']);
  assert.deepEqual(signs,['fresh-one','fresh-two']);assert.equal(prepared,2);
  assert.deepEqual(submissions.slice(0,2),[{i:0,signed:'signed-fresh-one'},{i:0,signed:undefined}]);
  assert.equal(result.status,'submitted');
});
test('resuming confirmed and response-lost steps never asks for another transaction signature',async()=>{
  const submitted=[];
  const result=await runPayment({authorize:async()=>({expires:Date.now()+100000}),
    prepare:async()=>({items:[{confirmed:true},{pending:true}]}),
    sign:async()=>assert.fail('must reconcile the saved signature'),
    submit:async(_,i,signed)=>{submitted.push({i,signed});return {status:i===2?'submitted':'step-confirmed'};}
  });
  assert.deepEqual(submitted,[{i:1,signed:undefined},{i:2,signed:undefined}]);assert.equal(result.status,'submitted');
});
test('uncertain expired history stops before any replacement signature or submission',async()=>{
  await assert.rejects(()=>runPayment({authorize:async()=>({expires:Date.now()+100000}),
    prepare:async()=>{throw Error('Waiting for complete finalized history');},
    sign:async()=>assert.fail('no replacement signing'),submit:async()=>assert.fail('no submission')}),/complete finalized history/);
});
test('a wallet rejection never advances the payment and a later refresh cannot replace a different transaction count',async()=>{
  let calls=0;
  await assert.rejects(()=>runPayment({authorize:async()=>({expires:Date.now()+100000}),
    prepare:async()=>({items:++calls===1?[{bytes:'one'},{bytes:'two'}]:[{confirmed:true}]}),
    sign:async()=> 'signed',submit:async()=>({status:'step-confirmed'})}),/count changed/);
  await assert.rejects(()=>runPayment({authorize:async()=>({expires:Date.now()+100000}),
    prepare:async()=>({items:[{bytes:'one'}]}),sign:async()=>{throw Error('Rejected by wallet');},
    submit:async()=>assert.fail('must not submit')}),/Rejected by wallet/);
});
