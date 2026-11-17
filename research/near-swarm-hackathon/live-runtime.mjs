import {OperationJournal} from './operation-journal.mjs';
import {PaymentControl} from './payment-control.mjs';
import {SolanaLiveClient} from './solana-live-client.mjs';
const exact=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).sort().join()===keys.slice().sort().join();
// Local integration only: session ownership must be verified by the caller. This
// creates plans and quotes, not funded NEAR jobs or autonomous agent grants.
export class LiveRuntime {
 constructor({dbPath,baseUrl,expectedOrigin,apiKey,fetchImpl=fetch}){
  this.journal=new OperationJournal(dbPath);
  this.factory=owner=>new SolanaLiveClient({baseUrl,expectedOrigin,apiKey,owner,journal:this.journal,fetchImpl});
  this.payments=new PaymentControl(dbPath,this.factory);
 }
 close(){this.payments.close();this.journal.close();}
 register(owner,input){
  if(!exact(input,['jobId','recipient','tokenMint','tokenDecimals','budgetRaw','perPaymentRaw']))throw Error('Invalid job parameters');
  const plan={owner,agent:'owner',status:'active',...input};
  return {jobId:plan.jobId,...this.payments.registerJob(owner,plan)};
 }
 quote(owner,input){
  if(!exact(input,['jobId','invoiceId','amountRaw']))throw Error('Invalid payment parameters');
  const plan=this.payments.getJob(owner,input.jobId);
  return this.payments.createPayment({owner,actor:'owner',plan,invoiceId:input.invoiceId,amountRaw:input.amountRaw});
 }
 freeze(owner,input){if(!exact(input,['jobId']))throw Error('Invalid job parameters');return this.payments.freeze(owner,input.jobId);}
 async prepare(owner,input){
  if(!exact(input,['jobId','invoiceId','idempotencyKey']))throw Error('Invalid preparation parameters');
  const plan=this.payments.getJob(owner,input.jobId);if(plan.status!=='active')throw Error('Job is frozen');
  const payment=this.payments.getPayment(owner,input.jobId,input.invoiceId);
  const response=await this.factory(owner).prepare(payment.transferId,input.idempotencyKey);
  const t=response?.transfer;
  if(!t||String(t.id)!==payment.transferId||t.sourceOwner!==owner||t.recipientWallet!==plan.recipient||t.tokenMint!==plan.tokenMint||String(t.amountRaw)!==payment.amountRaw||t.isTest!==false)throw Error('Prepared transfer does not match approved payment');
  if(!response.preparedTxs || typeof response.preparedTxs!=='object')throw Error('Missing prepared transactions');
  return {transferId:payment.transferId,preparedTxs:response.preparedTxs};
 }
}
