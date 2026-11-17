// Durable coordinator for a disposable local NEAR chain ONLY.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {LocalNear,sha} from './rpc.mjs';
export const hash=value=>sha(Buffer.from(JSON.stringify(value))).toString('hex');
const units=n=>{if(typeof n!=='string'||!/^\d+$/.test(n)||BigInt(n)<=0n||BigInt(n)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('positive bounded synthetic units required');return n;};
const token=asset=>{if(asset==='SYNTH-USD')return 'usd.synthetic';if(asset==='SYNTH-NATIVE')return 'native.synthetic';throw Error('synthetic asset required');};
export class Interrupted extends Error{}
export class Coordinator {
 constructor(directory,rpc,crash=null){this.directory=directory;this.rpc=rpc;this.crash=crash;mkdirSync(directory,{recursive:true});this.db=new DatabaseSync(join(directory,'journal.sqlite'));this.db.exec('PRAGMA busy_timeout=30000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS positions(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS recoveries(id TEXT PRIMARY KEY,data TEXT NOT NULL);');this.tail=Promise.resolve();}
 close(){this.db.close();}
 get(table,id){const r=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);return r?JSON.parse(r.data):null;}
 put(table,id,data){this.db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(id,JSON.stringify(data));}
 rows(table){return this.db.prepare(`SELECT data FROM ${table}`).all().map(r=>JSON.parse(r.data));}
 checkpoint(stage){if(this.crash===stage)throw new Interrupted(stage);if(this.crash==='exit:'+stage)process.exit(73);}
 async exclusive(fn){const before=this.tail;let release;this.tail=new Promise(r=>release=r);await before;const lock=join(this.directory,'worker-lock');let owned=false;
 try{try{mkdirSync(lock);owned=true;}catch(e){if(e.code!=='EEXIST')throw e;let old;try{old=JSON.parse(readFileSync(join(lock,'owner.json')));}catch{throw Error('worker lock ambiguous; fail closed');}try{process.kill(old.pid,0);throw Error('another worker active');}catch(e){if(e.code!=='ESRCH')throw e;}rmSync(lock,{recursive:true});mkdirSync(lock);owned=true;}
 writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid}));return await fn();
 }finally{if(owned)rmSync(lock,{recursive:true,force:true});release();}}
 policy(key){return this.rpc.view('treasury.synthetic','policy',{key});}
 grant(key){return this.rpc.view('treasury.synthetic','payment',{key});}
 execute(caller,command){return this.rpc.call(caller,'treasury.synthetic','execute',{command});}
 async create({owner='alice.synthetic',agent='agent.synthetic',id,chain='base',asset='SYNTH-USD',recipient='merchant',per_payment='60',budget='100',funded='100',expires},makeAccount){return this.exclusive(async()=>{
 units(per_payment);units(budget);units(funded);token(asset);const key=hash(['mh-policy-v1','treasury.synthetic',owner,id]);
 const custody=hash(['mh-synthetic-custody-v1','treasury.synthetic',owner,key,chain,asset]);const address='v'+custody.slice(0,40)+'.synthetic';
 if(this.rows('positions').some(x=>x.address===address&&x.key!==key))throw Error('custody collision; fail closed');
 const p={key,owner,agent,id,chain,asset,recipient,per_payment,budget,funded,expires,custody,address,principal:funded,status:'creating'};
 let existing=this.get('positions',key);if(existing){for(const k of ['owner','agent','id','chain','asset','recipient','per_payment','budget','funded','expires'])if(existing[k]!==p[k])throw Error('position immutable');if(existing.status!=='creating')return existing;}
 this.put('positions',key,p);let onchain=await this.policy(key);if(!onchain){await this.execute(owner,{op:'create',id,agent,chain,asset,recipient,per_payment,budget,expires});onchain=await this.policy(key);}
 for(const k of ['owner','agent','chain','asset','recipient','per_payment','budget','expires'])if(onchain[k]!==p[k])throw Error('on-chain policy mismatch');
 this.checkpoint('after_policy_creation');await makeAccount(address);p.status='unfunded';this.put('positions',key,p);return p;
 });}
 fundingEnvelope(p){return {id:'fund-'+p.key,binding:hash(['fund',p.key,p.owner,p.address,p.asset,p.funded]),recipient:p.address,amount:p.funded,cancel:false};}
 async fund(key){return this.exclusive(async()=>{const p=this.get('positions',key);if(!p||!['unfunded','active'].includes(p.status))throw Error('funding frozen');if(p.status==='active')return p;
 await this.rpc.call(p.owner,token(p.asset),'fenced_transfer',this.fundingEnvelope(p),'1');this.checkpoint('after_funding');p.status='active';this.put('positions',key,p);return p;
 });}
 async authorize(policy,id,amount,caller='agent.synthetic'){return this.exclusive(async()=>{units(amount);const p=this.get('positions',policy);if(!p)throw Error('unknown position');const key=hash(['mh-payment-v1','treasury.synthetic',p.owner,id]);let payment=this.get('payments',key);
 if(payment){if(payment.policy!==policy||payment.amount!==amount||payment.caller!==caller)throw Error('idempotency conflict');if(payment.status!=='authorizing')return payment;}
 else{if(p.status!=='active')throw Error('position frozen');const reserved=this.rows('payments').filter(x=>x.policy===policy&&['authorizing','reserved'].includes(x.status)).reduce((s,x)=>s+BigInt(x.amount),0n);if(BigInt(p.principal)-reserved<BigInt(amount))throw Error('insufficient principal');payment={key,policy,id,amount,caller,status:'authorizing'};this.put('payments',key,payment);}
 try{const grant=await this.execute(caller,{op:'authorize',policy,id,amount});this.checkpoint('after_authorization');if(grant.key!==key||grant.payment.custody!==p.custody)throw Error('grant binding mismatch');payment.status=grant.payment.status;this.put('payments',key,payment);return payment;}
 catch(e){if(e.final){payment.status='rejected';this.put('payments',key,payment);}throw e;}
 });}
 envelope(p,payment,cancel=false){return {id:payment.key,binding:hash(['payment',p.key,p.address,p.owner,p.chain,p.asset,p.recipient,payment.amount]),recipient:p.recipient,amount:payment.amount,cancel};}
 async settle(p,payment,receipt){const expected=this.envelope(p,payment);if(receipt.binding!==expected.binding||receipt.recipient!==expected.recipient||receipt.amount!==expected.amount)throw Error('settlement binding mismatch');if(!['delivered','cancelled'].includes(receipt.outcome))throw Error('unknown is not final');
 await this.execute('resolver.synthetic',{op:'resolve',payment:payment.key,outcome:receipt.outcome});this.checkpoint('after_policy_resolution');
 this.db.exec('BEGIN IMMEDIATE');try{payment=this.get('payments',payment.key);p=this.get('positions',p.key);if(['reserved','authorizing'].includes(payment.status)){if(receipt.outcome==='delivered'){if(BigInt(p.principal)<BigInt(payment.amount))throw Error('principal mismatch');p.principal=(BigInt(p.principal)-BigInt(payment.amount)).toString();this.put('positions',p.key,p);}payment.status=receipt.outcome;this.put('payments',payment.key,payment);}else if(payment.status!==receipt.outcome)throw Error('conflicting local outcome');this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return payment;}
 async dispatch(key){return this.exclusive(async()=>{const payment=this.get('payments',key);if(!payment)throw Error('unknown payment');if(payment.status!=='reserved')return payment;const p=this.get('positions',payment.policy);if(p.status!=='active')throw Error('position frozen');
 const grant=await this.grant(key);if(!grant||grant.status!=='reserved')throw Error('reconcile grant before dispatch');this.checkpoint('before_send');
 const receipt=await this.rpc.call(p.address,token(p.asset),'fenced_transfer',this.envelope(p,payment),'1');this.checkpoint('after_transfer');return this.settle(p,payment,receipt);
 });}
 async reconcile(key){return this.exclusive(async()=>{const payment=this.get('payments',key);if(!payment)throw Error('unknown payment');const p=this.get('positions',payment.policy);const receipt=await this.rpc.view(token(p.asset),'operation',{account:p.address,id:key});if(!receipt)return 'unknown';return this.settle(p,payment,receipt);});}
 async recover(key,owner='alice.synthetic'){return this.exclusive(async()=>{let p=this.get('positions',key);if(!p||p.owner!==owner)throw Error('owner unauthorized');if(p.status==='recovered')return p;if(['creating','unfunded'].includes(p.status))throw Error('funding not reconciled');
 p.status='recovering';this.put('positions',key,p);await this.execute(owner,{op:'revoke',policy:key});this.checkpoint('after_freeze');
 for(let payment of this.rows('payments').filter(x=>x.policy===key&&['authorizing','reserved'].includes(x.status))){const grant=await this.grant(payment.key);if(!grant){payment.status='rejected';this.put('payments',payment.key,payment);continue;}
 const receipt=await this.rpc.call(p.address,token(p.asset),'fenced_transfer',this.envelope(p,payment,true),'1');this.checkpoint('after_cancel');await this.settle(p,payment,receipt);}
 p=this.get('positions',key);
 if(BigInt(p.principal)>0n){const envelope={id:'recover-'+key,binding:hash(['recovery',key,p.address,p.owner,p.asset,p.principal]),recipient:p.owner,amount:p.principal,cancel:false};
 let recovery=this.get('recoveries',key);if(recovery&&JSON.stringify(recovery.envelope)!==JSON.stringify(envelope))throw Error('recovery intent changed');if(!recovery){recovery={envelope,status:'pending'};this.put('recoveries',key,recovery);}
 const receipt=await this.rpc.call(p.address,token(p.asset),'fenced_transfer',envelope,'1');this.checkpoint('after_recovery_transfer');if(receipt.outcome!=='delivered'||receipt.binding!==envelope.binding)throw Error('unconfirmed recovery');recovery.status='delivered';this.put('recoveries',key,recovery);
 }
 p.principal='0';p.status='recovered';this.put('positions',key,p);return p;
 });}
}
