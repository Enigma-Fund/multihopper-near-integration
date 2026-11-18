import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,randomBytes,verify} from 'node:crypto';
import {nearContractServices,requireNearJob,requireNearInvoice,jobTermsHash,settlementStatement,NEAR_JOB_STORAGE,NEAR_INVOICE_STORAGE} from './near-contract.mjs';
import {base58} from '../../hub/near/sandbox/rpc.mjs';

function fixture(){
  const signer=generateKeyPairSync('ed25519');
  const pub=signer.publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const env={SWARM_NEAR_CONTRACT:'swarm.example.near',SWARM_NEAR_CODE_HASH:base58(randomBytes(32)),
    SWARM_NEAR_PUBLISHER_KEY:pub.toString('base64'),
    SWARM_NEAR_PUBLISHER_PRIVATE_KEY:signer.privateKey.export({format:'der',type:'pkcs8'}).toString('base64')};
  const config={network:'mainnet',publisher:env.SWARM_NEAR_PUBLISHER_KEY,job_storage:NEAR_JOB_STORAGE,invoice_storage:NEAR_INVOICE_STORAGE};
  let chain='mainnet',hash=env.SWARM_NEAR_CODE_HASH,permission='FullAccess';
  const calls=[];
  async function rpc(endpoint,method,args){
    assert.ok(['https://rpc.mainnet.near.org','https://rpc.mainnet.fastnear.com'].includes(endpoint));calls.push({method,args});
    if(method==='status')return {chain_id:chain};
    if(args.request_type==='view_account')return {code_hash:hash};
    if(args.request_type==='view_access_key')return {permission,nonce:42,block_hash:base58(randomBytes(32))};
    assert.equal(args.finality,'final');
    return {block_hash:base58(randomBytes(32)),result:[...Buffer.from(JSON.stringify(config))]};
  }
  return {env,signer,pub,calls,rpc,changeChain:v=>chain=v,changeHash:v=>hash=v,changePermission:v=>permission=v};
}

test('pins the deployed NEAR code, network, publisher and storage prices before preparing an unsigned wallet call',async()=>{
  const f=fixture(),client=nearContractServices(f.env,f.rpc);
  const plan=await client.prepare('alice.near','ed25519:'+base58(f.pub),'create_job',{job_key:'a'.repeat(64)},NEAR_JOB_STORAGE);
  assert.equal(plan.status,'near-approval-required');assert.equal(plan.deposit,NEAR_JOB_STORAGE);
  const wire=Buffer.from(plan.transaction,'base64');
  assert.equal(wire.readUInt32LE(0),10);assert.equal(wire.subarray(4,14).toString(),'alice.near');
  assert.equal(wire[14],0);assert.deepEqual(wire.subarray(15,47),f.pub);assert.equal(wire.readBigUInt64LE(47),43n);
  assert.equal(f.calls.filter(c=>c.method==='send_tx').length,0);
  f.changePermission({FunctionCall:{}});
  await assert.rejects(()=>client.prepare('alice.near','ed25519:'+base58(f.pub),'create_job',{},'0'),/full-access/);
});
test('rejects a different network or contract binary',async()=>{
  const f=fixture();f.changeChain('testnet');await assert.rejects(()=>nearContractServices(f.env,f.rpc).view('configuration',{}),/network/);
  f.changeChain('mainnet');f.changeHash(base58(randomBytes(32)));await assert.rejects(()=>nearContractServices(f.env,f.rpc).view('configuration',{}),/code changed/);
});
test('settlement signature binds the network, contract, job, invoice, outcome, amount and evidence',async()=>{
  const f=fixture(),receipt={job_key:'a'.repeat(64),invoice_key:'b'.repeat(64),outcome:'paid',credited:'100',evidence_hash:'c'.repeat(64)};
  const signed=await nearContractServices(f.env,f.rpc).attest(receipt);
  assert.ok(verify(null,Buffer.from(settlementStatement('mainnet',f.env.SWARM_NEAR_CONTRACT,receipt)),f.signer.publicKey,Buffer.from(signed.signature,'base64')));
  for(const field of Object.keys(receipt))assert.equal(verify(null,Buffer.from(settlementStatement('mainnet',f.env.SWARM_NEAR_CONTRACT,{...receipt,[field]:'changed'})),f.signer.publicKey,Buffer.from(signed.signature,'base64')),false);
});
test('on-chain job and invoice must match the signed website terms',async()=>{
  const body={nearOwner:'alice.near',nearJobId:'job',owner:base58(randomBytes(32)),id:'example'},job={recipient:base58(randomBytes(32)),budget:'100',cap:'60'};
  const state={owner:body.nearOwner,terms_hash:await jobTermsHash('https://example.org',body,job),budget:'100',per_payment:'60'};
  const near={view:async()=>state};assert.deepEqual(await requireNearJob(near,'https://example.org',body,job,'a'.repeat(64)),state);
  await assert.rejects(()=>requireNearJob(near,'https://other.org',body,job,'a'.repeat(64)),/differs/);
  state.budget='200';await assert.rejects(()=>requireNearJob(near,'https://example.org',body,job,'a'.repeat(64)),/differs/);
  near.view=async()=>({job_key:'a'.repeat(64),amount:'50',minimum:'49'});
  await assert.rejects(()=>requireNearInvoice(near,'a'.repeat(64),{external_id:'b'.repeat(64),amount:'51',minimum:'49'}),/differs/);
});

test('explorer links require the exact successful finalized NEAR operation',async()=>{
  const f=fixture(),hash=base58(randomBytes(32)),args={job_key:'a'.repeat(64),invoice_key:'b'.repeat(64)};
  const outcome={final_execution_status:'FINAL',status:{SuccessValue:''},receipts_outcome:[{outcome:{status:{SuccessValue:''}}}],
    transaction:{hash,signer_id:'alice.near',receiver_id:f.env.SWARM_NEAR_CONTRACT,
      actions:[{FunctionCall:{method_name:'reserve_invoice',args:Buffer.from(JSON.stringify(args)).toString('base64')}}]}};
  const client=nearContractServices(f.env,async(endpoint,method,params)=>method==='tx'?outcome:f.rpc(endpoint,method,params));
  assert.equal((await client.verifyOperation(hash,'alice.near','reserve_invoice',args)).finalized,true);
  await assert.rejects(()=>client.verifyOperation(hash,'alice.near','reserve_invoice',{...args,invoice_key:'c'.repeat(64)}),/different payment terms/);
  for(const change of [()=>outcome.final_execution_status='EXECUTED_OPTIMISTIC',
    ()=>{outcome.final_execution_status='FINAL';outcome.transaction.signer_id='someone.near';},
    ()=>{outcome.transaction.signer_id='alice.near';outcome.transaction.receiver_id='different.near';},
    ()=>{outcome.transaction.receiver_id=f.env.SWARM_NEAR_CONTRACT;outcome.status={Failure:'failed'};},
    ()=>{outcome.status={SuccessValue:''};outcome.receipts_outcome[0].outcome.status={Failure:'receipt failed'};}]){
    change();await assert.rejects(()=>client.verifyOperation(hash,'alice.near','reserve_invoice',args),/not a finalized/);
  }
});

test('dedicated implicit NEAR accounts are supported and remain bound to their exact deployment',async()=>{
  const f=fixture();f.env.SWARM_NEAR_CONTRACT=f.pub.toString('hex');
  const client=nearContractServices(f.env,f.rpc);
  const plan=await client.prepare(f.pub.toString('hex'),'ed25519:'+base58(f.pub),'create_job',{job_key:'d'.repeat(64)},NEAR_JOB_STORAGE);
  assert.equal(plan.contract,f.pub.toString('hex'));
  const wire=Buffer.from(plan.transaction,'base64');assert.equal(wire.readUInt32LE(0),64);assert.equal(wire.subarray(4,68).toString(),f.pub.toString('hex'));
  for(const invalid of ['abc.testnet','0x'+f.pub.toString('hex'),f.pub.toString('hex').toUpperCase(),'bad account.near']){
    assert.throws(()=>nearContractServices({...f.env,SWARM_NEAR_CONTRACT:invalid},f.rpc),/configuration/);
  }
});

test('NEAR read fallback verifies network and pinned configuration without submitting transactions',async()=>{
 const f=fixture();let fallback=0;
 const client=nearContractServices(f.env,async(endpoint,method,args)=>{
  if(endpoint==='https://rpc.mainnet.near.org')throw Error('Throttled');
  fallback++;assert.ok(['status','query'].includes(method));return f.rpc(endpoint,method,args);
 });
 await client.readiness();assert.ok(fallback>=3);
 f.changeChain('testnet');await assert.rejects(()=>nearContractServices(f.env,async(endpoint,method,args)=>{
  if(endpoint==='https://rpc.mainnet.near.org')throw Error('Throttled');return f.rpc(endpoint,method,args);
 }).readiness(),/network/);
});
