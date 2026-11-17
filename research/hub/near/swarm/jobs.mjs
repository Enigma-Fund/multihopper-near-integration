// Synthetic local job orchestration; the provider owns custody signing and principal.
import {DatabaseSync} from 'node:sqlite';
import {ProcessLease} from '../ordinary/lease.mjs';
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {sha} from '../sandbox/rpc.mjs';
export const hash=v=>sha(Buffer.from(JSON.stringify(v))).toString('hex');
const id=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,48}$/.test(s);
const units=s=>{if(typeof s!=='string'||!(/^[1-9]\d{0,38}$/).test(s)||BigInt(s)>((1n<<128n)-1n))throw Error('canonical U128 amount required');return BigInt(s);};
export function plan(input){
 if(Object.keys(input).sort().join()!=='budget,expires,jobId,owner,slots,title')throw Error('unsupported job fields');
 const {owner,jobId,title,budget,slots,expires}=input;
 if(!id(jobId)||!['alice.synthetic','bob.synthetic'].includes(owner)||typeof title!=='string'||title.length>160||!Number.isSafeInteger(expires)||expires<=0)throw Error('invalid synthetic job');
 if(!Array.isArray(slots)||slots.length<1||slots.length>8)throw Error('one to eight fixed agent allocations required');
 let total=0n;const seen=new Set();
 for(const s of slots){if(Object.keys(s).sort().join()!=='agent,allocation,id,perPayment,recipient'||!id(s.id)||seen.has(s.id)||!['researcher.synthetic','reviewer.synthetic'].includes(s.agent)||!['merchant','othermerchant'].includes(s.recipient))throw Error('invalid agent allocation');seen.add(s.id);const cap=units(s.allocation);if(units(s.perPayment)>cap)throw Error('payment cap exceeds allocation');total+=cap;}
 if(total!==units(budget))throw Error('allocations must equal the funded job budget');
 return {owner,jobId,title,budget,slots:slots.map(s=>({...s})),expires};
}
export class SwarmJobs {
 constructor(directory,rpc,provider,crash=null){mkdirSync(directory,{recursive:true});this.directory=directory;this.rpc=rpc;this.provider=provider;this.crash=crash;this.lease=new ProcessLease(directory,'job worker');this.db=new DatabaseSync(join(directory,'jobs.sqlite'));this.db.exec('PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,data TEXT NOT NULL);');this.tail=Promise.resolve();}
 close(){try{this.db.close();}finally{this.lease.close();}}
 get(t,k){const r=this.db.prepare(`SELECT data FROM ${t} WHERE id=?`).get(k);return r?JSON.parse(r.data):null;}
 put(t,k,v){this.db.prepare(`INSERT INTO ${t}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(k,JSON.stringify(v));}
 checkpoint(s){if(this.crash===s)process.exit(73);}
 async locked(fn){const before=this.tail;let done;this.tail=new Promise(r=>done=r);await before;try{return await fn();}finally{done();}}
 execute(actor,command){return this.rpc.call(actor,'treasury.synthetic','execute',{command});}
 async create(input,actor){return this.locked(async()=>{const p=plan(input);if(actor!==p.owner)throw Error('owner unauthorized');const key=hash(['swarm-job-v1',p.owner,p.jobId]);let job=this.get('jobs',key);
 if(job){if(JSON.stringify(job.plan)!==JSON.stringify(p))throw Error('job plan immutable');if(job.status!=='creating')return job;}
 else {job={key,plan:p,status:'creating',slots:p.slots.map(s=>({...s,policy:null,address:null})),reason:null};this.put('jobs',key,job);}
 for(const s of job.slots){const policyId=hash(['swarm-policy-v1',key,s.id]);const policy=hash(['mh-policy-v1','treasury.synthetic',p.owner,policyId]);let onchain=await this.rpc.view('treasury.synthetic','policy',{key:policy});
 const command={op:'create',id:policyId,agent:s.agent,chain:'base',asset:'SYNTH-USD',recipient:s.recipient,per_payment:s.perPayment,budget:s.allocation,expires:p.expires};
 if(!onchain){await this.execute(p.owner,command);onchain=await this.rpc.view('treasury.synthetic','policy',{key:policy});}
 for(const [k,v] of Object.entries({owner:p.owner,agent:s.agent,chain:'base',asset:'SYNTH-USD',recipient:s.recipient,per_payment:s.perPayment,budget:s.allocation,expires:p.expires}))if(onchain[k]!==v)throw Error('job policy mismatch');
 const custody=await this.provider.request({op:'register',policy,amount:s.allocation});s.policy=policy;s.address=custody.address;this.put('jobs',key,job);}
 job.status='funding';this.put('jobs',key,job);return job;});}
 async fund(key,actor){return this.locked(async()=>{const j=this.get('jobs',key);if(!j||actor!==j.plan.owner)throw Error('owner unauthorized');if(j.status==='active')return j;if(j.status!=='funding')throw Error('job funding unavailable');
 for(const s of j.slots){await this.provider.request({op:'fund',policy:s.policy});this.checkpoint('after_funding_slot');}
 j.status='active';this.put('jobs',key,j);return j;});}
 async pay({jobKey,slotId,invoiceId,amount,actor,...extra}){return this.locked(async()=>{if(Object.keys(extra).length)throw Error('payment overrides forbidden');units(amount);if(!id(invoiceId))throw Error('invalid invoice');const j=this.get('jobs',jobKey);if(!j||j.status!=='active')throw Error('job not active');const s=j.slots.find(s=>s.id===slotId);if(!s||actor!==s.agent)throw Error('agent unauthorized');
 // Customer-scoped invoice binding prevents retrying the same purchase in another job/slot.
 const invoice=hash(['swarm-invoice-v1',j.plan.owner,invoiceId]);let old=this.get('invoices',invoice);const binding={jobKey,slotId,invoiceId,amount,actor};
 if(old){if(JSON.stringify(old.binding)!==JSON.stringify(binding))throw Error('invoice binding conflict');if(old.status==='delivered')return old;}
 else {old={binding,status:'authorizing',grant:null,hash:null};this.put('invoices',invoice,old);}
 const grant=(await this.execute(actor,{op:'authorize',policy:s.policy,id:invoice,amount})).key;old.grant=grant;this.put('invoices',invoice,old);this.checkpoint('after_grant');
 const result=await this.provider.request({op:'deliver',grant});this.checkpoint('after_payment');old.status=result.state==='success'?'delivered':'failed';old.hash=result.hash;this.put('invoices',invoice,old);return old;});}
 async finish(key,actor,outcome='failed'){return this.locked(async()=>{const j=this.get('jobs',key);if(!j||actor!==j.plan.owner)throw Error('owner unauthorized');if(!['failed','completed'].includes(outcome))throw Error('invalid job outcome');
 if(j.reason&&j.reason!==outcome)throw Error('terminal job outcome immutable');if(['failed-recovered','completed-settled'].includes(j.status))return j;
 if(j.status==='creating')throw Error('finish setup before recovery');j.reason=outcome;j.status='stopping';this.put('jobs',key,j);this.checkpoint('after_job_freeze');
 // Revoke every allocation before starting any refund. In-flight signatures still require reconciliation.
 for(const s of j.slots)await this.execute(j.plan.owner,{op:'revoke',policy:s.policy});this.checkpoint('after_revoke_all');
 for(const s of j.slots){await this.provider.request({op:'recover',policy:s.policy});this.checkpoint('after_refund_slot');}
 j.status=outcome==='failed'?'failed-recovered':'completed-settled';this.put('jobs',key,j);return j;});}
 async snapshot(key){const j=this.get('jobs',key);if(!j)throw Error('unknown job');const slots=[];let principal=0n,spent=0n,funded=0n,refunded=0n;
 for(const s of j.slots){const state=await this.provider.request({op:'status',policy:s.policy});const policy=await this.rpc.view('treasury.synthetic','policy',{key:s.policy});principal+=BigInt(state.principal);spent+=BigInt(state.delivered);funded+=BigInt(state.funded);refunded+=BigInt(state.refunded);slots.push({role:s.id,agent:s.agent,recipient:s.recipient,allocation:s.allocation,perPayment:s.perPayment,address:s.address,principal:state.principal,spent:state.delivered,refunded:state.refunded,funded:state.funded,reserved:policy.reserved,state:state.status});}
 return {key:j.key,owner:j.plan.owner,title:j.plan.title,budget:j.plan.budget,status:j.status,principal:principal.toString(),spent:spent.toString(),funded:funded.toString(),refunded:refunded.toString(),slots};}
}
