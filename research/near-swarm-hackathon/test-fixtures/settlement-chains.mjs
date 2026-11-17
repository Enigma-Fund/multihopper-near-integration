// Run with the repository's loopback-only network profile. No external endpoints or wallet files.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID,sign} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,openSync,closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Sandbox} from '../../hub/near/sandbox/node.mjs';
import {key,keyFromSeed,sha,base58} from '../../hub/near/sandbox/rpc.mjs';
import {nearMessage,nearDigest} from '../site/near-job.mjs';
import {signedMessage} from '../site/orders.mjs';
import {serve} from '../site/worker.mjs';
import {store} from './settlement-db.mjs';
import {screeningConfigAddress} from '../site/settlement-evidence.mjs';

const require=createRequire(import.meta.url),sdk=require(process.env.SOLANA_WEB3_MODULE||'@solana/web3.js');
const {PublicKey,Keypair,Transaction,TransactionInstruction,SystemProgram,Ed25519Program,SYSVAR_INSTRUCTIONS_PUBKEY}=sdk;
const program=new PublicKey('4TPCmR2uN3hDM1FbTsf7ZtFXwXGSz4u1Kxv5YHj6eruX'),router='3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh';
const binary=process.env.SYNTH_ORCHESTRATOR;if(!binary)throw Error('Supply the local reviewed orchestrator build');
const temp=mkdtempSync(join(tmpdir(),'swarm-two-chains-')),logfile=join(temp,'validator.log'),log=openSync(logfile,'w');
const tools=process.env.SOLANA_VALIDATOR||'solana-test-validator',url='http://127.0.0.1:19541',origin='https://swarm.synthetic';
const accounts=[],ownerKey=Keypair.generate(),owner=ownerKey.publicKey.toBase58(),ownerEd=keyFromSeed(ownerKey.secretKey.slice(0,32)),agent=Keypair.generate(),screener=Keypair.generate(),keeper=Keypair.generate();
const disc=name=>sha(Buffer.from(name)).subarray(0,8),u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
function genesis(pub,lamports,owner,data=Buffer.alloc(0)){const path=join(temp,pub.toBase58()+'.json');writeFileSync(path,JSON.stringify({pubkey:pub.toBase58(),account:{lamports,data:[data.toString('base64'),'base64'],owner,executable:false,rentEpoch:0}}));accounts.push('--account',pub.toBase58(),path);}
const system=SystemProgram.programId.toBase58(),wallets=[ownerKey,agent,keeper];for(const k of wallets)genesis(k.publicKey,1000000000,system);
genesis(new PublicKey(screeningConfigAddress),2000000,router,Buffer.concat([disc('account:ComplianceConfig'),screener.publicKey.toBuffer()]));
const routes=[0,1].map(()=>{
 const id=randomBytes(32),salt=randomBytes(32);
 const [config,bump]=PublicKey.findProgramAddressSync([Buffer.from('orchestrator'),id],program);
 const [step,stepBump]=PublicKey.findProgramAddressSync([Buffer.from('orchestrator_step'),config.toBuffer(),Buffer.of(0)],program);
 genesis(config,3000000,program.toBase58(),Buffer.concat([disc('account:OrchestratorConfig'),id,ownerKey.publicKey.toBuffer(),Buffer.from([0,0,1,1,0,bump])]));
 const commitment=sha(Buffer.concat([Buffer.from('mh:step-transfer:v1'),agent.publicKey.toBuffer(),salt]));
 genesis(step,3000000,program.toBase58(),Buffer.concat([disc('account:OrchestratorStepState'),config.toBuffer(),Buffer.of(0),u64(0),Buffer.from([0,4]),commitment,u64(4999990),Buffer.of(stepBump),Buffer.alloc(32)]));
 return {id,salt,config,step};
});
const node=spawn(tools,['--ledger',join(temp,'ledger'),'--bind-address','127.0.0.1','--rpc-port','19541','--faucet-port','19544','--gossip-port','19545','--dynamic-port-range','19546-19575','--bpf-program',program.toBase58(),binary,...accounts,'--quiet'],{stdio:['ignore',log,log]});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(method,params){const r=await(await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:1,jsonrpc:'2.0',method,params}),signal:AbortSignal.timeout(5000)})).json();if(r.error)throw Error(JSON.stringify(r.error));return r.result;}
const db=store(),txs=new Map();let near;
try{
 for(let i=0;;i++){try{if(await rpc('getHealth',[])==='ok')break;}catch{}if(i>100||node.exitCode!==null)throw Error('Local validator unavailable: '+readFileSync(logfile,'utf8').slice(-1000));await pause(200);}
 const genesisHash=await rpc('getGenesisHash',[]);assert.notEqual(genesisHash,'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
 near=await Sandbox.create();await near.account('alice.synthetic');await near.rpc.verify();
 const id=randomUUID(),nearOwner='alice.synthetic',nearKey=key(nearOwner),job={recipient:agent.publicKey.toBase58(),budget:'11000000',cap:'5000000'};
 const mk=(pubkey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
 async function unsigned(payer,ixs){const {blockhash}=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value;return new Transaction({feePayer:payer.publicKey,recentBlockhash:blockhash}).add(...ixs);}
 function serialize(tx){return tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');}
 async function status(sig){return (await rpc('getSignatureStatuses',[[sig],{searchTransactionHistory:true}])).value[0];}
 async function finalized(sig){for(let i=0;i<200;i++){const s=await status(sig);if(s?.err)throw Error(JSON.stringify(s.err));if(s?.confirmationStatus==='finalized')return;await pause(200);}throw Error('Synthetic transaction did not finalize');}
 const services={configured:true,expectedTest:true,accessKey:(account_id,public_key)=>near.rpc.rpc('query',{request_type:'view_access_key',finality:'final',account_id,public_key}),
 account:async p=>(await rpc('getAccountInfo',[p,{encoding:'base64',commitment:'finalized'}])).value,
 create:async b=>{const t={...b,id:txs.size+1,destinationCount:1,destinations:null,isTest:true,phase:'quoted',recipientReceivesRaw:'4999990'};txs.set(b.externalId,t);return t;},find:async ref=>txs.get(ref),status:async id=>[...txs.values()].find(t=>String(t.id)===id),
 preparePayment:async id=>({transfer:await services.status(id),preparedTxs:{routeInitTxs:[{base64:serialize(await unsigned(ownerKey,[SystemProgram.transfer({fromPubkey:ownerKey.publicKey,toPubkey:routes[Number(id)-1].step,lamports:4999990})]))}],sessionInitTxs:[],dispersionInitTxs:[]}}),
 prepareRefund:async id=>{const r=routes[Number(id)-1];const ix=new TransactionInstruction({programId:program,keys:[mk(ownerKey.publicKey,true,true),mk(ownerKey.publicKey,false,true),mk(r.config,false,true),mk(r.step,false,true),mk(SystemProgram.programId)],data:Buffer.concat([disc('global:refund_failed_step'),r.id,Buffer.of(0)])});return {rescueTxs:[{base64:serialize(await unsigned(ownerKey,[ix]))}]};},
 confirmPayment:async()=>({}),confirmRefund:async id=>{(await services.status(id)).phase='rescued';},
 signatureState:status,transaction:(sig,encoding)=>rpc('getTransaction',[sig,{encoding,commitment:'finalized',maxSupportedTransactionVersion:0}]),
 broadcast:bytes=>rpc('sendTransaction',[bytes,{encoding:'base64',preflightCommitment:'confirmed'}]),
 simulatedDebit:async bytes=>{const result=await rpc('simulateTransaction',[bytes,{encoding:'base64',sigVerify:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:[owner]}}]);assert.equal(result.value.err,null,JSON.stringify(result));const before=await rpc('getBalance',[owner,{commitment:'confirmed'}]);return String(Math.max(before.value-result.value.accounts[0].lamports,0));}};
 async function api(action,data={}){
 const b={id,owner,expires:Date.now()+230000,action,...data};b.signature=sign(null,Buffer.from(signedMessage(origin,b)),ownerEd.privateKey).toString('hex');
 const r=await serve(new Request(origin+'/near-swarm/api/'+(action==='create'?'orders':'settlement'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}),{SWARM_JOBS:db},{},undefined,services);
 const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j;}
 await api('create',{...job,limit:job.cap});
 const body={id,owner,nearOwner,nearJobId:'dual-chain-job',expires:Date.now()+230000},nonce=randomBytes(32);
 const digest=await nearDigest(nearMessage(origin,body,job),nonce,new URL(origin).host);
 const linked=await api('link',{...body,nearProof:{nonce:nonce.toString('hex'),publicKey:nearKey.publicKey,accountId:nearOwner,signature:sign(null,Buffer.from(digest),nearKey.privateKey).toString('base64')}});
 async function wallet(invoice,mode){
 const params={invoice,mode,extra:'1000000'},batch=await api('prepare-wallet',params),tx=Transaction.from(Buffer.from(batch.items[0].bytes,'base64'));tx.partialSign(ownerKey);
 const s=await api('wallet-step',{...params,step:0,signedTx:serialize(tx)});await finalized(s.signature);
 assert.equal((await api('prepare-wallet',params)).items[0].pending,true);
 assert.equal((await api('wallet-step',{...params,step:0})).status,'step-confirmed');
 assert.equal((await api('wallet-step',{...params,step:1})).status,'submitted');}
 for(const invoice of ['payout','recovery']){await api('invoice',{invoice,recipient:job.recipient,amount:'5000000',minimum:'4900000'});await wallet(invoice,'payment');}
 const r=routes[0],expiry=u64(Math.floor(Date.now()/1000)+600);
 const m=Buffer.concat([Buffer.from('MHC:v1:step'),program.toBuffer(),r.id,Buffer.of(0),ownerKey.publicKey.toBuffer(),agent.publicKey.toBuffer(),Buffer.alloc(32),expiry]);
 const proof=Ed25519Program.createInstructionWithPrivateKey({privateKey:screener.secretKey,message:m});
 const pay=new TransactionInstruction({programId:program,keys:[mk(keeper.publicKey,true,true),mk(r.config),mk(r.step,false,true),mk(agent.publicKey,false,true),mk(SystemProgram.programId),mk(new PublicKey(screeningConfigAddress)),mk(SYSVAR_INSTRUCTIONS_PUBKEY)],data:Buffer.concat([disc('global:execute_step_transfer_committed'),r.id,Buffer.of(0),r.salt])});
 const tx=await unsigned(keeper,[proof,pay]);tx.partialSign(keeper);const sig=await services.broadcast(serialize(tx));await finalized(sig);
 const t=await services.status('1');t.phase='settled';t.destinations=[{wallet:job.recipient,amountRaw:'4999990',status:'paid',payoutSignature:sig}];
 const payout=await api('refresh',{invoice:'payout'});assert.equal(payout.status,'payout-confirmed');assert.equal(payout.creditedLamports,'4999990');
 const tr=await services.status('2');tr.phase='recoverable';tr.recovery={canRescue:true};await wallet('recovery','recovery');
 const refund=await api('refresh',{invoice:'recovery'});assert.equal(refund.status,'recovery-credit-confirmed');assert.equal(refund.creditedLamports,'7999990');assert.equal(refund.jobKey,linked.jobKey);
 console.log(JSON.stringify({network:'local validators',job:linked.jobKey,payout:{status:payout.status,credit:payout.creditedLamports,slot:payout.transactions[0].slot},recovery:{status:refund.status,credit:refund.creditedLamports,slot:refund.transactions[0].slot},scope:'Simulated MultiHopper API and screening signer. Real local NEAR access key, Solana orchestrator and finality.'}));
}finally{if(near)await near.cleanup();if(node.exitCode===null&&node.signalCode===null){const stopped=once(node,'exit');node.kill('SIGTERM');await stopped;}closeSync(log);rmSync(temp,{recursive:true,force:true});}
