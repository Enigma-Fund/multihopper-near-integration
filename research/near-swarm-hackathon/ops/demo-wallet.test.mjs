import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {deploymentWire,inspectNear,sha,base58} from './near-wire.mjs';
import {unsignedNearCall} from '../site/near-contract.mjs';
import {approvalJournal} from './approval-journal.mjs';
import {checkWorkOrderMessage} from './message-policy.mjs';
import {signedMessage} from '../site/orders.mjs';
const identity=()=>{const b=randomBytes(32);return {accountId:b.toString('hex'),publicKey:'ed25519:'+base58(b)};};
function setup(){const wasm=Buffer.from('synthetic contract bytes'),config={contract:identity(),operator:identity(),publisher:randomBytes(32).toString('base64'),wasmSha256:sha(wasm).toString('hex')};
  const args={account:config.contract.accountId,publicKey:config.contract.publicKey,nonce:42,blockHash:base58(randomBytes(32)),wasm,publisher:config.publisher};return {wasm,config,args};}
test('native wallet accepts the actual canonical work-order format and rejects wrong origins, owners and expired messages',()=>{
  const owner=base58(randomBytes(32)),origin='https://example.org',now=Date.now();
  const text=signedMessage(origin,{action:'create',id:'12345678-1234-1234-1234-123456789012',owner,recipient:base58(randomBytes(32)),budget:'5000000',limit:'2500000',expires:now+240000},now);
  assert.doesNotThrow(()=>checkWorkOrderMessage(text,origin,owner,now));
  assert.throws(()=>checkWorkOrderMessage(text,'https://other.example',owner,now));
  assert.throws(()=>checkWorkOrderMessage(text,origin,base58(randomBytes(32)),now));
  assert.throws(()=>checkWorkOrderMessage(text,origin,owner,now+300000));
});
test('deployment pins signer, exact code, initialization publisher and zero deposit',()=>{
  const {config,args}=setup(),wire=deploymentWire(args).toString('base64');const tx=inspectNear(wire,config);
  assert.equal(tx.role,'near-contract');assert.equal(tx.actions.length,2);assert.equal(tx.nonce,42n);
  for(const change of [{...args,wasm:Buffer.from('other code')},{...args,publisher:randomBytes(32).toString('base64')},{...args,account:config.operator.accountId}])assert.throws(()=>inspectNear(deploymentWire(change).toString('base64'),config));
  assert.throws(()=>inspectNear(Buffer.concat([Buffer.from(wire,'base64'),Buffer.of(0)]).toString('base64'),config));
});
test('ordinary signing permits only this contract and bounded job storage deposits',()=>{
  const {config,args}=setup();const plan={signer:config.operator.accountId,publicKey:config.operator.publicKey,nonce:42,blockHash:args.blockHash,contract:config.contract.accountId,method:'reserve_invoice',args:{job_key:'a'.repeat(64)},deposit:'20000000000000000000000'};
  assert.equal(inspectNear(unsignedNearCall(plan),config).role,'near-operator');
  for(const change of [{method:'transfer'},{method:'new'},{deposit:'30000000000000000000000'},{contract:config.operator.accountId},{signer:config.contract.accountId}])assert.throws(()=>inspectNear(unsignedNearCall({...plan,...change}),config));
});
test('lost broadcast response is reconciled without signing or sending a second transaction, including restart',async()=>{
  const rows=new Map();let signs=0,broadcasts=0;const order=[];
  const deps={load:async k=>rows.get(k),save:async(k,v)=>{order.push('saved');rows.set(k,v);},prepare:async()=>({}),sign:async()=>{signs++;return Buffer.alloc(64);},pack:async key=>({key,kind:'near-sign',hash:'fixed'}),broadcast:async()=>{broadcasts++;order.push('broadcast');throw Error('response lost');},resolve:async row=>({confirmed:row.hash})};
  await assert.rejects(()=>approvalJournal(deps)('one',{}),/response lost/);
  assert.deepEqual(order,['saved','broadcast']);assert.deepEqual(await approvalJournal(deps)('one',{}),{confirmed:'fixed'});
  assert.equal(signs,1);assert.equal(broadcasts,1);
});
test('concurrent approvals are serialized and a failed durable save cannot broadcast',async()=>{
  let release;const wait=new Promise(r=>release=r);let broadcasts=0;
  const deps={load:async()=>null,save:async()=>{throw Error('disk unavailable');},prepare:async()=>{},sign:async()=>wait,pack:async()=>({kind:'near-sign'}),broadcast:async()=>{broadcasts++;},resolve:async()=>{}};
  const run=approvalJournal(deps),first=run('one',{});
  await assert.rejects(()=>run('one',{}),/Another signature/);release(Buffer.alloc(64));await assert.rejects(()=>first,/disk unavailable/);assert.equal(broadcasts,0);
});
test('wallet rejection never persists or broadcasts and an explicit retry remains possible',async()=>{
  let calls=0,saves=0;
  const run=approvalJournal({load:async()=>null,save:async()=>{saves++;},prepare:async()=>({}),sign:async()=>{calls++;throw Error('declined');},pack:async()=>{},broadcast:async()=>assert.fail('must not broadcast'),resolve:async()=>{}});
  await assert.rejects(()=>run('one',{}),/declined/);await assert.rejects(()=>run('one',{}),/declined/);assert.equal(saves,0);assert.equal(calls,2);
});
