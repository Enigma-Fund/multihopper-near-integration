// LOCAL SYNTHETIC provider. Private state belongs to this process, not the coordinator.
import {DatabaseSync} from 'node:sqlite';
import {ProcessLease} from './lease.mjs';
import {randomBytes} from 'node:crypto';
import {mkdirSync,chmodSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {LocalNear,actions,key,keyFromSeed,prepareExact,submitExact,sha,base58} from '../sandbox/rpc.mjs';
const hash=v=>sha(Buffer.from(JSON.stringify(v))).toString('hex');
const token=a=>({'SYNTH-USD':'ordinaryusd.synthetic','SYNTH-NATIVE':'ordinarynative.synthetic'})[a] || (()=>{throw Error('synthetic asset required');})();
const units=x=>{if(typeof x!=='string'||!(/^[1-9]\d{0,38}$/).test(x)||BigInt(x)>(1n<<128n)-1n)throw Error('invalid synthetic units');return x;};
const exact=(request,names)=>{if(Object.keys(request).sort().join()!==names.sort().join())throw Error('unsupported request fields');};
export class GrantProvider {
 #db; #rpc; #lock; #crash; #pins;
 constructor(config){
  process.umask(0o077);mkdirSync(config.directory,{recursive:true,mode:0o700});chmodSync(config.directory,0o700);
  this.#lock=new ProcessLease(config.directory,'provider');
  this.#db=new DatabaseSync(join(config.directory,'private.sqlite'));chmodSync(join(config.directory,'private.sqlite'),0o600);
  this.#db.exec('PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS positions(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS identity(id TEXT PRIMARY KEY,data TEXT NOT NULL);');
  this.#rpc=new LocalNear(config.port,config.chainId);this.#crash=config.crash;this.#pins=config.codeHashes;
  const identity={chainId:config.chainId,codeHashes:config.codeHashes};const prior=this.#get('identity','chain');
  if(prior&&JSON.stringify(prior)!==JSON.stringify(identity))throw Error('provider chain/code identity changed');this.#put('identity','chain',identity);
 }
 close(){this.#db.close();this.#lock.close();}
 #get(table,id){const r=this.#db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);return r?JSON.parse(r.data):null;}
 #put(table,id,value){this.#db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(id,JSON.stringify(value));}
 #all(table){return this.#db.prepare(`SELECT data FROM ${table}`).all().map(x=>JSON.parse(x.data));}
 #checkpoint(stage){if(this.#crash===stage)process.exit(73);}
 async #verify(){await this.#rpc.verify();for(const [account_id,code_hash] of Object.entries(this.#pins)){const a=await this.#rpc.rpc('query',{request_type:'view_account',finality:'final',account_id});if(a.code_hash!==code_hash)throw Error('contract code identity changed');}}
 async #policy(id){const p=await this.#rpc.view('treasury.synthetic','policy',{key:id});if(!p)throw Error('unknown policy');return p;}
 #remaining(p){return this.#all('operations').filter(x=>x.policy===p.key&&x.state==='success').reduce((n,x)=>n+(x.kind==='fund'?BigInt(x.amount):['pay','refund'].includes(x.kind)?-BigInt(x.amount):0n),0n);}
 #public(p){const ops=this.#all('operations').filter(x=>x.policy===p.key&&x.state==='success');const total=kind=>ops.filter(x=>x.kind===kind).reduce((n,x)=>n+BigInt(x.amount),0n).toString();return {key:p.key,owner:p.owner,address:p.address,asset:p.asset,chain:p.chain,status:p.state,principal:this.#remaining(p).toString(),funded:total('fund'),delivered:total('pay'),refunded:total('refund')};}
 async #storage(contract,account){if(await this.#rpc.view(contract,'storage_balance_of',{account_id:account}))return;
 const bounds=await this.#rpc.view(contract,'storage_balance_bounds',{});const min=BigInt(bounds.min);if(min<0n||min>10n**22n)throw Error('storage cost exceeds sponsor cap');
 await this.#rpc.call('synthetic',contract,'storage_deposit',{account_id:account,registration_only:true},min.toString());
 if(!await this.#rpc.view(contract,'storage_balance_of',{account_id:account}))throw Error('registration unconfirmed');}
 async #account(p){const k=keyFromSeed(Buffer.from(p.seed,'hex'));let a;try{a=await this.#rpc.rpc('query',{request_type:'view_account',finality:'final',account_id:p.address});}catch(e){if(!e.message.includes('UNKNOWN_ACCOUNT'))throw e;}
 if(!a){await this.#rpc.send('synthetic',p.address,[actions.create(),actions.transfer(10n**25n),actions.addPublicKey(k.pub)]);}
 const keys=await this.#rpc.rpc('query',{request_type:'view_access_key_list',finality:'final',account_id:p.address});
 if(keys.keys.length!==1||keys.keys[0].public_key!==k.publicKey||keys.keys[0].access_key.permission!=='FullAccess')throw Error('custody key mismatch');
 a=await this.#rpc.rpc('query',{request_type:'view_account',finality:'final',account_id:p.address});if(a.code_hash!=='11111111111111111111111111111111')throw Error('unexpected custody code');
 }
 async #register(id,amount){units(amount);const policy=await this.#policy(id),contract=token(policy.asset);let p=this.#get('positions',id);
 if(p){if(p.funded!==amount)throw Error('immutable funding amount');}
 else{const custody=hash(['mh-synthetic-custody-v1','treasury.synthetic',policy.owner,id,policy.chain,policy.asset]);p={...policy,key:id,custody,address:'g'+custody.slice(0,40)+'.synthetic',token:contract,seed:randomBytes(32).toString('hex'),funded:amount,state:'creating'};if(this.#all('positions').some(x=>x.address===p.address))throw Error('custody collision');this.#put('positions',id,p);}
 if(p.state==='creating'){await this.#account(p);for(const account of [p.owner,p.address,p.recipient])await this.#storage(contract,account);p.state='unfunded';this.#put('positions',id,p);}
 return this.#public(p);
 }
 // Exactly one signed payload per logical operation; no timeout-based replacement/cancellation.
 async #transfer(p,id,kind,signer,recipient,amount){
 let op=this.#get('operations',id);const binding={policy:p.key,kind,signer,recipient,amount,token:p.token};
 if(op&&JSON.stringify(op.binding)!==JSON.stringify(binding))throw Error('immutable operation conflict');
 if(!op){
  if(this.#all('operations').some(x=>x.signer===signer&&x.state==='pending'))throw Error('unresolved signer transaction');
  if(signer===p.address)await this.#account(p);
  const k=signer===p.address?keyFromSeed(Buffer.from(p.seed,'hex')):key(signer);
  const tx=await prepareExact(this.#rpc,signer,p.token,[actions.call('ft_transfer',{receiver_id:recipient,amount,memo:null},'1')],k);
  op={...binding,binding,id,tx,state:'pending'};this.#put('operations',id,op);this.#checkpoint(kind+'_prepared');
  return this.#finish(op,true);
 }
 return this.#finish(op,false);
 }
 async #finish(op,fresh){
 if(op.state!=='pending')return {state:op.state,hash:op.tx.hash};await this.#rpc.verify();let r;
 if(!fresh){try{r=await this.#rpc.rpc('tx',{tx_hash:op.tx.hash,sender_account_id:op.signer,wait_until:'NONE'});}catch(e){if(!e.message.includes('UNKNOWN_TRANSACTION'))throw Error('transaction outcome unknown; recovery blocked');}}
 if(!r||r.final_execution_status!=='FINAL'){
  try{r=await submitExact(this.#rpc,op.tx);}catch{throw Error('transaction outcome unknown; recovery blocked');}
 }
 if(r.final_execution_status!=='FINAL'||r.transaction?.hash!==op.tx.hash||r.transaction?.signer_id!==op.signer||r.transaction?.receiver_id!==op.token)throw Error('unverified transaction outcome');
 this.#checkpoint(op.kind+'_after_chain');
 if(r.status?.Failure)op.state='failed';else if(Object.hasOwn(r.status||{},'SuccessValue'))op.state='success';else throw Error('transaction outcome unknown');
 // Only finalized execution of our exact single ft_transfer action changes recognized principal.
 op.receipt={hash:op.tx.hash,status:r.status};this.#put('operations',op.id,op);this.#checkpoint(op.kind+'_after_record');return {state:op.state,hash:op.tx.hash};
 }
 async #fund(p){if(!['unfunded','active'].includes(p.state))throw Error('position frozen');if(!this.#get('operations','fund:'+p.key)){const policy=await this.#policy(p.key);const now=Math.floor(Date.parse((await this.#rpc.verify()).sync_info.latest_block_time)/1000);if(policy.revoked||now>=policy.expires)throw Error('funding policy inactive');}const r=await this.#transfer(p,'fund:'+p.key,'fund',p.owner,p.address,p.funded);if(r.state!=='success')throw Error('funding failed; no principal credited');p.state='active';this.#put('positions',p.key,p);return this.#public(p);}
 async #deliver(key){const g=await this.#rpc.view('treasury.synthetic','payment',{key});if(!g)throw Error('unknown grant');const p=this.#get('positions',g.policy);if(!p)throw Error('unregistered custody');const policy=await this.#policy(p.key);
 const expected={custody:p.custody,recipient:p.recipient,chain:p.chain,asset:p.asset,policy:p.key};for(const [k,v]of Object.entries(expected))if(g[k]!==v)throw Error('grant binding mismatch');units(g.amount);
 const old=this.#get('operations','pay:'+key);
 if(!old){const now=Math.floor(Date.parse((await this.#rpc.verify()).sync_info.latest_block_time)/1000);
 if(p.state!=='active'||policy.revoked||now>=policy.expires||g.status!=='reserved')throw Error('grant inactive');
 if(BigInt(g.amount)>BigInt(policy.per_payment)||BigInt(policy.spent)+BigInt(policy.reserved)>BigInt(policy.budget))throw Error('grant spending limit');
 const pending=this.#all('operations').filter(x=>x.policy===p.key&&x.kind==='pay'&&x.state==='pending').reduce((n,x)=>n+BigInt(x.amount),0n);
 if(this.#remaining(p)-pending<BigInt(g.amount))throw Error('insufficient recognized principal');
 }
 const r=await this.#transfer(p,'pay:'+key,'pay',p.address,p.recipient,g.amount);
 await this.#resolve(key,r.state==='success'?'delivered':'cancelled');return r;
 }
 async #resolve(payment,outcome){await this.#rpc.call('resolver.synthetic','treasury.synthetic','execute',{command:{op:'resolve',payment,outcome}});this.#checkpoint('after_resolution');}
 async #recover(p){const policy=await this.#policy(p.key);if(!policy.revoked)throw Error('owner must revoke policy on-chain');if(p.state==='recovered')return this.#public(p);
 if(p.state==='creating')throw Error('custody setup not complete');
 if(p.state==='unfunded'){
  const funding=this.#get('operations','fund:'+p.key);
  if(funding)await this.#finish(funding,false);
  // Zero-principal positions still reconcile/cancel grants below; no new funding is initiated.
 }
 p.state='recovering';this.#put('positions',p.key,p);this.#checkpoint('after_freeze');
 const grants=await this.#rpc.view('treasury.synthetic','payments_for_policy',{policy:p.key});
 for(const [id,g]of grants){const op=this.#get('operations','pay:'+id);
  if(op){const r=await this.#finish(op,false);await this.#resolve(id,r.state==='success'?'delivered':'cancelled');}
  else {if(g.status==='delivered')throw Error('unbacked delivered grant; fail closed');await this.#resolve(id,'cancelled');}
 }
 this.#checkpoint('after_reconcile');
 const refund=this.#get('operations','refund:'+p.key);
 if(refund){const r=await this.#finish(refund,false);if(r.state!=='success')throw Error('refund failed; manual reconciliation required');}
 else {const remaining=this.#remaining(p);if(remaining<0n)throw Error('principal invariant');if(remaining>0n){const r=await this.#transfer(p,'refund:'+p.key,'refund',p.address,p.owner,remaining.toString());if(r.state!=='success')throw Error('refund failed; manual reconciliation required');}}
 p.state='recovered';this.#put('positions',p.key,p);return this.#public(p);
 }
 async request(r){await this.#verify();if(!r||typeof r!=='object')throw Error('invalid provider request');
 if(r.op==='register'){exact(r,['op','policy','amount']);return this.#register(r.policy,r.amount);}
 if(r.op==='deliver'){exact(r,['op','grant']);return this.#deliver(r.grant);}
 if(['fund','recover','status'].includes(r.op)){exact(r,['op','policy']);const p=this.#get('positions',r.policy);if(!p)throw Error('unknown custody');if(r.op==='fund')return this.#fund(p);if(r.op==='recover')return this.#recover(p);return this.#public(p);}
 throw Error('arbitrary signing/export method forbidden');
 }
}
