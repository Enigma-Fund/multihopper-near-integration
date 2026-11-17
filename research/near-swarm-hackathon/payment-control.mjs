import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const ID=/^[A-Za-z0-9_-]{1,48}$/;
const ADDRESS=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const validId=v=>typeof v==='string'&&ID.test(v);
const validAddress=v=>typeof v==='string'&&ADDRESS.test(v);
function units(value){if(typeof value!=='string'||!/^[1-9]\d{0,37}$/.test(value))throw Error('Positive raw amount required');return BigInt(value);}
function tokenAmount(raw,decimals){const n=BigInt(raw),scale=10n**BigInt(decimals);if(!decimals)return n.toString();return `${n/scale}.${(n%scale).toString().padStart(decimals,'0')}`;}
function digest(...parts){return createHash('sha256').update(JSON.stringify(parts)).digest('hex');}
// Local research coordinator. The caller must supply an independently verified,
// server-side job plan and authenticated actor; this is not an on-chain grant.
export class PaymentControl {
 constructor(path,clientForOwner){this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, job_id TEXT NOT NULL, invoice_id TEXT NOT NULL, binding TEXT NOT NULL, amount TEXT NOT NULL, status TEXT NOT NULL, transfer_id TEXT); CREATE TABLE IF NOT EXISTS job_bindings (owner TEXT NOT NULL,job_id TEXT NOT NULL,binding TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',plan TEXT,PRIMARY KEY(owner,job_id));");const columns=this.db.prepare('PRAGMA table_info(job_bindings)').all();if(!columns.some(c=>c.name==='status'))this.db.exec("ALTER TABLE job_bindings ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");if(!columns.some(c=>c.name==='plan'))this.db.exec('ALTER TABLE job_bindings ADD COLUMN plan TEXT');this.clientForOwner=clientForOwner;}
 close(){this.db.close();}
 registerJob(owner,plan){
  if(!validAddress(owner)||!plan||Object.keys(plan).sort().join()!=='agent,budgetRaw,jobId,owner,perPaymentRaw,recipient,status,tokenDecimals,tokenMint'||plan.owner!==owner||!validId(plan.agent)||plan.status!=='active'||!validId(plan.jobId)||!validAddress(plan.recipient)||!validAddress(plan.tokenMint)||!Number.isInteger(plan.tokenDecimals)||plan.tokenDecimals<0||plan.tokenDecimals>18||units(plan.perPaymentRaw)>units(plan.budgetRaw))throw Error('Valid owner-approved job required');
  const binding=digest('job-v1',owner,plan.jobId,plan.agent,plan.recipient,plan.tokenMint,plan.tokenDecimals,plan.budgetRaw,plan.perPaymentRaw);
  this.db.exec('BEGIN IMMEDIATE');try{
   const old=this.db.prepare('SELECT binding,status FROM job_bindings WHERE owner=? AND job_id=?').get(owner,plan.jobId);
   if(old && old.binding!==binding)throw Error('Job plan is immutable');
   if(old && old.status!=='active')throw Error('Job is frozen');
   if(!old)this.db.prepare('INSERT INTO job_bindings(owner,job_id,binding,plan) VALUES(?,?,?,?)').run(owner,plan.jobId,binding,JSON.stringify(plan));
   this.db.exec('COMMIT');return {status:'active'};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 getJob(owner,jobId){
  if(!validAddress(owner)||!validId(jobId))throw Error('Valid job identity required');
  const row=this.db.prepare('SELECT plan,status FROM job_bindings WHERE owner=? AND job_id=?').get(owner,jobId);
  if(!row||!row.plan)throw Error('Job not found or requires migration');
  return {...JSON.parse(row.plan),status:row.status};
 }
 getPayment(owner,jobId,invoiceId){
  if(!validAddress(owner)||!validId(jobId)||!validId(invoiceId))throw Error('Valid payment identity required');
  const id=digest('invoice-v1',owner,invoiceId);
  const row=this.db.prepare('SELECT owner,job_id,amount,status,transfer_id FROM reservations WHERE id=?').get(id);
  if(!row||row.owner!==owner||row.job_id!==jobId)throw Error('Payment not found');
  if(row.status!=='quoted'||!row.transfer_id)throw Error('Payment requires reconciliation');
  return {transferId:row.transfer_id,amountRaw:row.amount,status:row.status};
 }
 freeze(owner,jobId){
  if(!validAddress(owner)||!validId(jobId))throw Error('Valid job identity required');
  this.db.exec('BEGIN IMMEDIATE');try{
   const job=this.db.prepare('SELECT status FROM job_bindings WHERE owner=? AND job_id=?').get(owner,jobId);
   if(!job)throw Error('Job not found');
   this.db.prepare("UPDATE job_bindings SET status='frozen' WHERE owner=? AND job_id=?").run(owner,jobId);
   const pending=this.db.prepare('SELECT COUNT(*) AS count FROM reservations WHERE owner=? AND job_id=?').get(owner,jobId).count;
   this.db.exec('COMMIT');return {status:'frozen',reconciliationRequired:pending>0};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 async createPayment({owner,actor,plan,invoiceId,amountRaw}){
  if(!validAddress(owner)||!validId(actor)||!plan||plan.owner!==owner||plan.agent!==actor||plan.status!=='active'||!validId(plan.jobId)||!validId(invoiceId)||!validAddress(plan.recipient)||!validAddress(plan.tokenMint)||!Number.isInteger(plan.tokenDecimals)||plan.tokenDecimals<0||plan.tokenDecimals>18)throw Error('Authorized active job required');
  const amount=units(amountRaw),budget=units(plan.budgetRaw),cap=units(plan.perPaymentRaw);if(amount>cap||amount>budget)throw Error('Payment limit exceeded');
  const id=digest('invoice-v1',owner,invoiceId),binding=digest('payment-v1',owner,actor,plan.jobId,invoiceId,amountRaw,plan.recipient,plan.tokenMint,plan.tokenDecimals);
  let old;this.db.exec('BEGIN IMMEDIATE');try{
   const jobBinding=digest('job-v1',owner,plan.jobId,plan.agent,plan.recipient,plan.tokenMint,plan.tokenDecimals,plan.budgetRaw,plan.perPaymentRaw);
   const registered=this.db.prepare('SELECT binding,status FROM job_bindings WHERE owner=? AND job_id=?').get(owner,plan.jobId);
   if(!registered)throw Error('Owner-approved job required');
   if(registered.status!=='active')throw Error('Job is frozen');
   if(registered.binding!==jobBinding)throw Error('Job plan is immutable');
   old=this.db.prepare('SELECT binding,status,transfer_id FROM reservations WHERE id=?').get(id);
   if(old){if(old.binding!==binding)throw Error('Invoice binding conflict');if(old.status!=='quoted')throw Error('Payment outcome requires reconciliation');}
   else {const rows=this.db.prepare('SELECT amount FROM reservations WHERE owner=? AND job_id=?').all(owner,plan.jobId);const allocated=rows.reduce((a,x)=>a+BigInt(x.amount),0n);if(allocated+amount>budget)throw Error('Job budget exceeded');this.db.prepare('INSERT INTO reservations(id,owner,job_id,invoice_id,binding,amount,status) VALUES(?,?,?,?,?,?,?)').run(id,owner,plan.jobId,invoiceId,binding,amountRaw,'uncertain');}
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  if(old)return {transferId:old.transfer_id,status:'quoted'};
  const client=this.clientForOwner(owner);
  const input={sourceOwner:owner,recipientWallet:plan.recipient,tokenMint:plan.tokenMint,tokenDecimals:plan.tokenDecimals,amountRaw,amountTokens:tokenAmount(amountRaw,plan.tokenDecimals),externalId:id};
  const result=await client.create(input,id);
  if(!result||result.sourceOwner!==owner||result.recipientWallet!==plan.recipient||result.tokenMint!==plan.tokenMint||String(result.amountRaw)!==amountRaw||result.externalId!==id||result.status!=='quote'||result.isTest!==false||!/^\d+$/.test(String(result.id)))throw Error('Transfer quote does not match job; reconciliation required');
  const transferId=String(result.id);this.db.prepare("UPDATE reservations SET status='quoted',transfer_id=? WHERE id=? AND status='uncertain'").run(transferId,id);
  return {transferId,status:'quoted'};
 }
}
