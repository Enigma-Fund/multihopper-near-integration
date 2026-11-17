import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SolanaTestClient} from './solana-execution-client.mjs';
import {OperationJournal} from './operation-journal.mjs';
const key='mh_test_not_a_real_credential';
test('test client binds the endpoint, credentials and stable idempotency keys',async()=>{
 const calls=[];const fetchImpl=async(url,options)=>{calls.push({url:String(url),options});return {ok:true,text:async()=>'{"ok":true}'};};
 const journal=new OperationJournal(':memory:');const client=new SolanaTestClient({baseUrl:'http://127.0.0.1:1234/api/v1',apiKey:key,fetchImpl,journal,owner:'wallet_A'});
 await client.create({amountRaw:'100',sourceOwner:'owner'},'job_1234');
 assert.equal(calls[0].url,'http://127.0.0.1:1234/api/v1/transfers');assert.equal(calls[0].options.headers['idempotency-key'],'job_1234');assert.equal(calls[0].options.redirect,'error');
 await client.prepare(42,'prepare_1234');await client.status(42);await client.confirm(42,{routeInitSignatures:['synthetic']},'confirm_1234');await client.prepareRecovery(42,'recover_1234');await client.confirmRecovery(42,['synthetic'],'recover_confirm_1234');
 assert.deepEqual(calls.map(c=>new URL(c.url).pathname),['/api/v1/transfers','/api/v1/transfers/42/prepare','/api/v1/transfers/42','/api/v1/transfers/42/confirm-broadcast','/api/v1/transfers/42/rescue/prepare','/api/v1/transfers/42/rescue/confirm']);
 await assert.rejects(()=>client.create({},'bad'),/idempotency/);assert.throws(()=>client.status('../42'),/Invalid transfer/);
 assert.throws(()=>new SolanaTestClient({baseUrl:'https://production.example/api/v1',apiKey:key}),/Devnet/);
 assert.throws(()=>new SolanaTestClient({baseUrl:'http://127.0.0.1/api/v1',apiKey:'mh_live_no'}),/Test API/);journal.close();
});
test('ambiguous network failure does not cause an automatic retry',async()=>{
 let attempts=0;const journal=new OperationJournal(':memory:');const client=new SolanaTestClient({baseUrl:'http://localhost:1234/api/v1',apiKey:key,journal,owner:'wallet_A',fetchImpl:async()=>{attempts++;throw Error('connection lost');}});
 await assert.rejects(()=>client.create({},'operation_123'),/connection lost/);await assert.rejects(()=>client.create({},'operation_123'),/reconciliation required/);assert.equal(attempts,1);journal.close();
});
