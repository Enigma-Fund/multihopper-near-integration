import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Sandbox} from '../../hub/near/sandbox/node.mjs';
import {settlementStatement} from '../site/near-contract.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publisher = generateKeyPairSync('ed25519');
const publicKey = publisher.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
const wasm = fileURLToPath(new URL('./target/wasm32-unknown-unknown/release/multihopper_swarm_jobs.wasm',import.meta.url));
const jobDeposit = '10000000000000000000000';
const invoiceDeposit = '20000000000000000000000';
const contract = 'jobs.synthetic';
let sandbox;
let assertions = 0;
async function rejects(operation, pattern) { await assert.rejects(operation, pattern); assertions++; }
const began = Date.now();
try {
  sandbox = await Sandbox.create();
  for (const name of ['alice','bob','agent','intruder']) await sandbox.account(name+'.synthetic');
  await sandbox.account(contract,wasm,{publisher:publicKey,network:'local'});
  const rpc = sandbox.rpc;
  const call = (owner,method,args,deposit='0') => rpc.call(owner,contract,method,args,deposit);
  const view = (method,args) => rpc.view(contract,method,args);
  const job = (owner,id='job') => ({job_key:hash(['swarm-job-v1',owner,id]),job_id:id,agent:'agent.synthetic',terms_hash:hash([owner,id]),budget:'100',per_payment:'60'});
  const alice = job('alice.synthetic'), bob = job('bob.synthetic');
  await call('alice.synthetic','create_job',alice,jobDeposit);
  await call('bob.synthetic','create_job',bob,jobDeposit);
  await rejects(()=>call('intruder.synthetic','create_job',alice,jobDeposit),/another customer/);
  await rejects(()=>call('alice.synthetic','create_job',{...alice,budget:'101'}),/immutable/);
  await call('alice.synthetic','create_job',alice);
  await rejects(()=>call('alice.synthetic','create_job',alice,jobDeposit),/zero deposit/);
  const first = {job_key:alice.job_key,invoice_key:hash('first'),amount:'60',minimum:'59'};
  await rejects(()=>call('intruder.synthetic','reserve_invoice',first,invoiceDeposit),/not authorized/);
  await rejects(()=>call('agent.synthetic','reserve_invoice',{...first,amount:'61'},invoiceDeposit),/signed limit/);
  await call('agent.synthetic','reserve_invoice',first,invoiceDeposit);
  await call('agent.synthetic','reserve_invoice',first);
  await rejects(()=>call('agent.synthetic','reserve_invoice',{...first,amount:'59'}),/immutable/);
  const second = {...first,invoice_key:hash('second'),amount:'40',minimum:'39'};
  await rejects(()=>call('agent.synthetic','reserve_invoice',{...second,amount:'41'},invoiceDeposit),/budget exceeded/);
  await call('agent.synthetic','reserve_invoice',second,invoiceDeposit);
  assert.equal((await view('get_job',{job_key:alice.job_key})).reserved,'100');
  assert.equal((await view('get_job',{job_key:bob.job_key})).reserved,'0');
  // The same invoice identifier in another customer's job has independent state.
  await call('bob.synthetic','reserve_invoice',{...first,job_key:bob.job_key},invoiceDeposit);
  function attestation(invoice,outcome,credited,domain=contract) {
    const receipt={job_key:invoice.job_key,invoice_key:invoice.invoice_key,outcome,credited,evidence_hash:hash([invoice.invoice_key,outcome])};
    return {...receipt,signature:sign(null,Buffer.from(settlementStatement('local',domain,receipt)),publisher.privateKey).toString('base64')};
  }
  const paid = attestation(first,'paid','59');
  await rejects(()=>call('intruder.synthetic','record_settlement',{...paid,signature:Buffer.alloc(64).toString('base64')}),/publisher signature/);
  await rejects(()=>call('intruder.synthetic','record_settlement',attestation(first,'paid','59','wrong.synthetic')),/publisher signature/);
  await rejects(()=>call('intruder.synthetic','record_settlement',{...paid,credited:'60'}),/publisher signature/);
  await rejects(()=>call('intruder.synthetic','record_settlement',attestation(first,'paid','58')),/invoice limits/);
  await call('agent.synthetic','record_settlement',paid);
  await sandbox.restart();
  await call('agent.synthetic','record_settlement',paid);
  await rejects(()=>call('agent.synthetic','record_settlement',attestation(first,'refunded','59')),/Conflicting/);
  await call('alice.synthetic','close_job',{job_key:alice.job_key});
  await rejects(()=>call('agent.synthetic','reserve_invoice',{...first,invoice_key:hash('after-close')},invoiceDeposit),/closed/);
  await rejects(()=>call('agent.synthetic','close_job',{job_key:bob.job_key}),/customer/);
  const refund = attestation(second,'refunded','43');
  await call('agent.synthetic','record_settlement',refund);
  await sandbox.restart();
  await call('agent.synthetic','record_settlement',refund);
  const final = await view('get_job',{job_key:alice.job_key});
  assert.equal(final.reserved,'0');assert.equal(final.spent,'100');assert.equal(final.closed,true);
  assert.equal((await view('get_invoice',{job_key:alice.job_key,invoice_key:second.invoice_key})).status,'refunded');
  assert.equal((await view('get_invoice',{job_key:bob.job_key,invoice_key:first.invoice_key})).status,'reserved');
  const output={network:'local NEAR sandbox',contractWasmSha256:createHash('sha256').update(readFileSync(wasm)).digest('hex'),
    wasmBytes:readFileSync(wasm).length,rejectedCases:assertions,completed:true,elapsedMs:Date.now()-began,
    scenarios:['two customers','job-key squatting','agent spending limits','budget exhaustion','duplicate invoices','tampered receipt','wrong-chain domain','node restart after payout','job closure','node restart after refund','duplicate publication'],
    receipts:rpc.receipts};
  writeFileSync('/private/tmp/swarm-near-contract-results.json',JSON.stringify(output,null,2));
  console.log(JSON.stringify({...output,receipts:output.receipts.length}));
} finally { if(sandbox)await sandbox.cleanup(); }
