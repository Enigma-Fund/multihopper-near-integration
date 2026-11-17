import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {store} from '../test-fixtures/settlement-db.mjs';
import {walletBatch,inspectWire} from './wallet-bundle.mjs';
import {messageHash} from './settlement-evidence.mjs';
import {base58} from '../../hub/near/sandbox/rpc.mjs';
function identity(){const k=generateKeyPairSync('ed25519');return {...k,pub:k.publicKey.export({format:'der',type:'spki'}).subarray(-32)};}
function transaction(owner,coSigner){
 const recipient=coSigner??identity(),count=coSigner?2:1,block=randomBytes(32),data=Buffer.alloc(coSigner?52:12);data.writeUInt32LE(coSigner?0:2);data.writeBigUInt64LE(10n,4);
 const msg=Buffer.concat([Buffer.from([count,0,1,3]),owner.pub,recipient.pub,Buffer.alloc(32),block,Buffer.from([1,2,2,0,1,data.length]),data]);
 const signatures=[Buffer.alloc(64),...(coSigner?[sign(null,msg,coSigner.privateKey)]:[])],head=Buffer.concat([Buffer.of(count),...signatures]);
 const unsigned=Buffer.concat([head,msg]),signed=Buffer.from(unsigned);sign(null,msg,owner.privateKey).copy(signed,1);
 return {unsigned:unsigned.toString('base64'),signed:signed.toString('base64'),signature:base58(signed.subarray(1,65)),blockhash:base58(block)};
}
async function setup(){
 const db=store(),owner=identity(),address=base58(owner.pub),job={state:'open',recipient:base58(identity().pub)},row={owner:address,id:'job',external_id:'ref',transfer_id:'1',amount:'100',quoted_net:'90'};
 db.prepare('INSERT INTO swarm_orders(owner,id,recipient,budget,cap) VALUES(?,?,?,?,?)').bind(address,'job',job.recipient,'100','100').run();
 db.prepare('INSERT INTO swarm_near_links(owner,id,near_owner,near_job,job_key,access_block) VALUES(?,?,?,?,?,?)').bind(address,'job','alice.near','near-job','key','block').run();
 db.prepare('INSERT INTO swarm_invoices(owner,id,invoice,external_id,amount,minimum,transfer_id,quoted_net) VALUES(?,?,?,?,?,?,?,?)').bind(address,'job','one','ref',100,80,'1','90').run();
 const wires=[transaction(owner),transaction(owner,identity()),transaction(owner)];
 const transfer={id:1,externalId:'ref',sourceOwner:address,tokenMint:'So11111111111111111111111111111111111111112',isTest:true,amountRaw:'100',recipientReceivesRaw:'90',destinationCount:1};
 let prepared={transfer,preparedTxs:{keeperFundingTx:wires[0].unsigned,routeInitTxs:[{base64:wires[1].unsigned}],orchestratorInitTx:wires[2].unsigned,sessionInitTxs:[],dispersionInitTxs:[]}};
 const statuses=new Map(),sent=[];
 const services={expectedTest:true,finalizedSlot:async()=>500,blockAvailable:async()=>true,preparePayment:async()=>prepared,signatureState:async s=>statuses.get(s),simulatedDebit:async()=> '10',broadcast:async bytes=>{const t=inspectWire(bytes,address);sent.push(t.signature);statuses.set(t.signature,{confirmationStatus:'finalized',err:null});return t.signature;},confirmPayment:async()=>{}};
 const fields={mode:'payment',extra:'20',batchReview:true},call=body=>walletBatch(db,services,row,{...fields,...body},job);
 await call({action:'prepare-wallet'});
 return {db,owner,job,row,wires,transfer,services,call,sent,setPrepared:p=>prepared=p};
}
test('store the entire signed batch, enforce cumulative costs, resume after response loss and never repeat funding',async()=>{
 const s=await setup(),signedTransactions=s.wires.map((w,step)=>({step,bytes:w.signed}));
 await assert.rejects(()=>s.call({action:'stage-wallet',signedTransactions:signedTransactions.slice(1)}),/entire/);
 const bad=[...signedTransactions];bad[1]={step:1,bytes:transaction(identity()).signed};
 await assert.rejects(()=>s.call({action:'stage-wallet',signedTransactions:bad}));
 await s.call({action:'stage-wallet',signedTransactions});await s.call({action:'stage-wallet',signedTransactions});assert.equal(s.sent.length,0);
 const real=s.services.broadcast;s.services.broadcast=async bytes=>{await real(bytes);throw Error('lost response');};
 await assert.rejects(()=>s.call({action:'wallet-step',step:0}),/lost response/);s.services.broadcast=real;
 assert.equal((await s.call({action:'wallet-step',step:0})).status,'step-confirmed');
 assert.equal((await s.call({action:'wallet-step',step:0})).status,'step-confirmed');assert.equal(s.sent.length,1);
 s.services.simulatedDebit=async()=> '111';await assert.rejects(()=>s.call({action:'wallet-step',step:1}),/cost limit/);assert.equal(s.sent.length,1);
 s.services.simulatedDebit=async()=> '10';
 for(const step of [1,2]){assert.equal((await s.call({action:'wallet-step',step})).status,'confirming');assert.equal((await s.call({action:'wallet-step',step})).status,'step-confirmed');}
 assert.equal((await s.call({action:'wallet-step',step:3})).status,'submitted');assert.equal((await s.call({action:'wallet-step',step:3})).status,'submitted');assert.equal(new Set(s.sent).size,3);
});
test('fresh batch changes ephemeral co-signers only after complete expired history and preserves confirmed funding',async()=>{
 const s=await setup(),keeper=s.wires[0],state=[{signature:keeper.signature,debit:'10',landed:true}];
 s.db.prepare('UPDATE swarm_wallet_batches SET progress=? WHERE reference=?').bind(JSON.stringify(state),'ref').run();
 const newRoute=transaction(s.owner,identity()),newOrch=transaction(s.owner),newHashes=new Set([newRoute.blockhash,newOrch.blockhash]);
 s.services.blockAvailable=async hash=>newHashes.has(hash);let checked=[];
 s.services.findExpiredMessage=async(_,born,digest)=>{assert.equal(born,500);checked.push(digest);return null;};
 s.setPrepared({transfer:s.transfer,preparedTxs:{routeInitTxs:[{base64:newRoute.unsigned}],orchestratorInitTx:newOrch.unsigned,sessionInitTxs:[],dispersionInitTxs:[]}});
 const fresh=await s.call({action:'prepare-wallet'});
 assert.equal(checked.length,2);assert.equal(fresh.items[0].confirmed,true);assert.equal(fresh.items[0].bytes,keeper.unsigned);assert.equal(fresh.items[1].bytes,newRoute.unsigned);
 assert.equal(s.sent.length,0);
});
test('incomplete history or repeated keeper funding cannot create a replacement batch',async()=>{
 const s=await setup();s.services.blockAvailable=async()=>false;s.services.findExpiredMessage=async()=>{throw Error('history incomplete');};
 await assert.rejects(()=>s.call({action:'prepare-wallet'}),/history incomplete/);assert.equal(s.sent.length,0);
 const state=[{signature:s.wires[0].signature,debit:'10',landed:true}];s.db.prepare('UPDATE swarm_wallet_batches SET progress=? WHERE reference=?').bind(JSON.stringify(state),'ref').run();
 s.services.findExpiredMessage=async()=>null;await assert.rejects(()=>s.call({action:'prepare-wallet'}),/repeated confirmed keeper/);
});
test('closing a job between read and batch storage prevents admission of new signatures',async()=>{
 const s=await setup();s.db.prepare("UPDATE swarm_orders SET state='closed' WHERE owner=? AND id=?").bind(s.row.owner,s.row.id).run();
 await assert.rejects(()=>s.call({action:'stage-wallet',signedTransactions:s.wires.map((w,step)=>({step,bytes:w.signed}))}),/state changed/);
 assert.equal(s.sent.length,0);
});
