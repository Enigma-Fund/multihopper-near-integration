import assert from 'node:assert/strict';
import {test} from 'node:test';
import {store} from '../test-fixtures/settlement-db.mjs';
import {createHash,generateKeyPairSync,sign,randomBytes,randomUUID} from 'node:crypto';
import {serve} from './worker.mjs';
import {signedMessage,JOB_MINT} from './orders.mjs';
import {nearDigest,nearMessage} from './near-job.mjs';
import {verifyPayout,verifyRecovery,messageHash,screeningConfigAddress,verifyPaymentScreen} from './settlement-evidence.mjs';
import {inspectWire} from './wallet-bundle.mjs';
import {base58} from '../../hub/near/sandbox/rpc.mjs';

const origin='https://workspace.example',program='4TPCmR2uN3hDM1FbTsf7ZtFXwXGSz4u1Kxv5YHj6eruX';
const sha=v=>createHash('sha256').update(v).digest();
function identity(){const k=generateKeyPairSync('ed25519');const pub=k.publicKey.export({format:'der',type:'spki'}).subarray(-32);return {pub,owner:base58(pub),privateKey:k.privateKey};}
function wire(owner,recipient,units){
 const program=Buffer.alloc(32),block=randomBytes(32),data=Buffer.alloc(12);data.writeUInt32LE(2);data.writeBigUInt64LE(BigInt(units),4);
 const msg=Buffer.concat([Buffer.from([1,0,1,3]),owner.pub,recipient.pub,program,block,Buffer.from([1,2,2,0,1,12]),data]);
 const sig=sign(null,msg,owner.privateKey);return {unsigned:Buffer.concat([Buffer.from([1]),Buffer.alloc(64),msg]).toString('base64'),signed:Buffer.concat([Buffer.from([1]),sig,msg]).toString('base64'),signature:base58(sig)};
}
test('two-wallet job binding, budget race, signed wallet funding, lost broadcast, recovery and receipt replay',async()=>{
 const db=store(),customer=identity(),agent=identity(),near=identity(),screener=identity(),owner=customer.owner,id=randomUUID(),job={recipient:agent.owner,budget:'10000000',cap:'6000000'};
 const cfg={owner:'3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh',executable:false,data:[Buffer.concat([sha('account:ComplianceConfig').subarray(0,8),screener.pub]).toString('base64'),'base64']};
 const transfers=new Map(),known=new Map(),receipts=new Map(),batches=new Map();let loss=true,broadcasts=0,fee='10';
 const services={configured:true,expectedTest:true,account:async()=>cfg,accessKey:async()=>({permission:'FullAccess',block_hash:base58(randomBytes(32))}),
 find:async ref=>transfers.get(ref),status:async id=>[...transfers.values()].find(t=>t.id===Number(id)),create:async body=>{if(transfers.has(body.externalId))return transfers.get(body.externalId);
 const t={...body,id:transfers.size+1,isTest:true,destinationCount:1,recipientReceivesRaw:String(BigInt(body.amountRaw)-10n),destinations:null,phase:'quoted'};transfers.set(body.externalId,t);if(loss){loss=false;throw Error('lost quote response');}return t;},
 preparePayment:async id=>({transfer:await services.status(id),preparedTxs:{routeInitTxs:[{base64:batches.get(id).unsigned}],sessionInitTxs:[],dispersionInitTxs:[]}}),
 simulatedDebit:async()=>fee,signatureState:async s=>known.get(s),broadcast:async bytes=>{const tx=inspectWire(bytes,owner);broadcasts++;known.set(tx.signature,{confirmationStatus:'finalized',err:null});throw Error('lost broadcast response');},
 confirmPayment:async(id,body)=>{assert.deepEqual(body.routeInitSignatures,[batches.get(id).signature]);},
 transaction:async(sig,encoding)=>receipts.get(sig)?.[encoding]};
 async function send(action,data={},who=customer,jobId=id,change={}){
 const body={expires:Date.now()+240000,owner:who.owner,id:jobId,action,...data};
 body.signature=sign(null,Buffer.from(signedMessage(origin,body)),who.privateKey).toString('hex');
 const req=new Request(origin+'/near-swarm/api/'+(['create','close','read'].includes(action)?'orders':'settlement'),{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({...body,...change})});
 const r=await serve(req,{SWARM_JOBS:db}, {},undefined,services);return {code:r.status,...await r.json()};}
 assert.equal((await send('create',{recipient:job.recipient,budget:job.budget,limit:job.cap})).code,200);
 const expires=Date.now()+230000,link={expires,nearOwner:'alice.near',nearJobId:'work-42'},nonce=randomBytes(32);
 const digest=await nearDigest(nearMessage(origin,{...link,id,owner},job),nonce,new URL(origin).host);
 link.nearProof={accountId:link.nearOwner,publicKey:'ed25519:'+near.owner,nonce:nonce.toString('hex'),signature:sign(null,Buffer.from(digest),near.privateKey).toString('base64')};
 assert.equal((await send('link',{...link,nearJobId:'other'})).code,400);
 const binding=await send('link',link);assert.equal(binding.code,200,JSON.stringify(binding));
 assert.equal((await send('link',link)).jobKey,binding.jobKey);
 const invoice={invoice:'one',recipient:agent.owner,amount:'6000000',minimum:'5990000'};
 assert.equal((await send('invoice',invoice,customer,id,{minimum:'1'})).code,400);
 assert.equal((await send('invoice',invoice,identity())).code,400);
 assert.match((await send('invoice',invoice)).error,/lost quote/);
 const q=await send('invoice',invoice);assert.equal(q.code,200,JSON.stringify(q));assert.equal(q.quotedNetLamports,'5999990');
 assert.equal(transfers.size,1);
 const other={...invoice,amount:'4000000',minimum:'3000000'};
 const race=await Promise.all(['two','three'].map(invoice=>send('invoice',{...other,invoice})));assert.deepEqual(race.map(r=>r.code).sort(),[200,400]);
 const payment=wire(customer,agent,10);batches.set(q.transferId,payment);
 services.finalizedSlot=async()=>1;services.blockAvailable=async()=>true;
 const fields={invoice:'one',mode:'payment',extra:'10'};
 assert.equal((await send('prepare-wallet',fields)).items.length,1);
 services.blockAvailable=async()=>false;services.findExpiredMessage=async()=>{throw Error('incomplete finalized history');};
 assert.match((await send('prepare-wallet',fields)).error,/incomplete finalized history/);
 services.findExpiredMessage=async()=>null;services.latestBlock=async()=>({blockhash:base58(randomBytes(32))});
 const renewed=await send('prepare-wallet',fields);assert.notEqual(renewed.items[0].bytes,payment.unsigned);services.blockAvailable=async()=>true;
 assert.equal((await send('wallet-step',{...fields,step:0,signedTx:payment.signed})).code,400);
 const fresh=Buffer.from(renewed.items[0].bytes,'base64'),sig=sign(null,fresh.subarray(65),customer.privateKey);sig.copy(fresh,1);
 payment.signature=base58(sig);const step={...fields,step:0,signedTx:fresh.toString('base64')};
 assert.equal((await send('wallet-step',{...step,signedTx:wire(customer,agent,10).signed})).code,400);
 fee='6000011';assert.match((await send('wallet-step',step)).error,/cost limit/);assert.equal(broadcasts,0);fee='10';
 assert.match((await send('wallet-step',step)).error,/lost broadcast/);
 assert.equal((await send('prepare-wallet',fields)).items[0].pending,true);
 assert.equal((await send('wallet-step',{...fields,step:0})).status,'step-confirmed');
 assert.equal((await send('wallet-step',{...fields,step:1})).status,'submitted');assert.equal(broadcasts,1);
 const t=transfers.get(q.reference),payout=base58(randomBytes(64)),stepAccount=identity().owner;
 const route=randomBytes(32),ixdata=Buffer.concat([sha('global:execute_step_transfer_committed').subarray(0,8),route,Buffer.of(0),randomBytes(32)]);
 const expiresAt=Buffer.alloc(8);expiresAt.writeBigInt64LE(2000n);
 const {fromBase58}=await import('./orders.mjs');
 const msg=Buffer.concat([Buffer.from('MHC:v1:step'),fromBase58(program,32),route,Buffer.of(0),customer.pub,agent.pub,Buffer.alloc(32),expiresAt]);
 const header=Buffer.alloc(16);header[0]=1;[48,65535,16,65535,112,msg.length,65535].forEach((x,i)=>header.writeUInt16LE(x,2+i*2));
 const proof={programId:'Ed25519SigVerify111111111111111111111111111',data:base58(Buffer.concat([header,screener.pub,sign(null,msg,screener.privateKey),msg]))};
 const ix={programId:program,data:base58(ixdata),accounts:[owner,identity().owner,stepAccount,agent.owner,'11111111111111111111111111111111',screeningConfigAddress]};
 const tx={slot:4,blockTime:1000,meta:{err:null,fee:5,preBalances:[50,7000000,10],postBalances:[45,1000010,6000000],innerInstructions:[]},
 transaction:{signatures:[payout],message:{accountKeys:[owner,stepAccount,agent.owner].map(pubkey=>({pubkey})),instructions:[proof,ix]}}};
 receipts.set(payout,{jsonParsed:tx});t.phase='settled';t.destinations=[{wallet:agent.owner,amountRaw:'5999990',status:'paid',payoutSignature:payout}];
 const final=await send('refresh',{invoice:'one'});assert.equal(final.status,'payout-confirmed',JSON.stringify(final));assert.equal(final.transactions[0].screening.coverage,'Payment creator and destination');
 assert.deepEqual(await send('refresh',{invoice:'one'}),final);
 await assert.rejects(()=>verifyPayout(services.transaction,payout,agent.owner,'1'));
 await assert.rejects(()=>verifyPaymentScreen(tx,identity().owner,agent.owner,screener.pub));
 await assert.rejects(()=>verifyPaymentScreen(tx,owner,agent.owner,identity().pub));
 const otherQ=race.find(r=>r.code===200),refund=wire(customer,agent,1);
 const tr=transfers.get(otherQ.reference);tr.phase='recoverable';tr.recovery={canRescue:true};
 services.prepareRefund=async()=>({rescueTxs:[{base64:refund.unsigned}]});
 assert.equal((await send('prepare-refund',{invoice:otherQ.invoice})).status,'recovery-prepared');
 tr.phase='rescued';
 const recoveryIx={programId:program,accounts:[owner,owner],data:base58(Buffer.concat([sha('global:refund_failed_step').subarray(0,8),randomBytes(33)]))};
 const rtx={slot:12,meta:{err:null,fee:5,preBalances:[500],postBalances:[515]},transaction:{signatures:[refund.signature],message:{accountKeys:[{pubkey:owner}],instructions:[recoveryIx]}}};
 receipts.set(refund.signature,{base64:{slot:12,meta:{err:null},transaction:[refund.signed,'base64']},jsonParsed:rtx});
 await assert.rejects(()=>verifyRecovery(services.transaction,[refund.signature,refund.signature],['duplicate','duplicate'],owner));
 assert.equal((await send('refresh',{invoice:otherQ.invoice,refundSignatures:[payout]})).code,400);
 const refundResult=await send('refresh',{invoice:otherQ.invoice,refundSignatures:[refund.signature]});assert.equal(refundResult.status,'recovery-credit-confirmed',JSON.stringify(refundResult));assert.equal(refundResult.creditedLamports,'20');
 const history=(await send('read')).job;assert.equal(history.near.jobKey,binding.jobKey);assert.deepEqual(new Set(history.recentInvoices.map(i=>i.outcome)),new Set(['payout-confirmed','recovery-credit-confirmed']));assert.equal((await send('close')).job.state,'closed');assert.equal((await send('invoice',{...invoice,invoice:'closed'})).code,400);
});
