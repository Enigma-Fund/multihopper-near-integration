import {resumeStore,resumeFields} from '/near-swarm/resume-state.mjs';
import {authorizationCache} from '/near-swarm/authorization-cache.mjs';
import {meteorRequest} from '/near-swarm/near-wallet.mjs';
import {localDemoWallet,localNearRequest,prepareLocalApproval} from '/near-swarm/local-demo-wallet.mjs';
import {runPayment} from '/near-swarm/payment-runner.mjs';
import {runBatchPayment} from '/near-swarm/batch-payment.mjs';
import {signedMessage,fromBase58} from './orders.mjs';
import {nearMessage} from '/near-swarm/near-job.mjs';
import {lookupReceipt} from '/near-swarm/receipt.mjs';

const el = id => document.getElementById(id);
const permissions=authorizationCache();
function guide(target,why){
  document.querySelectorAll('.guided-target').forEach(node=>node.classList.remove('guided-target'));
  const action=el('guide-action');
  action.hidden=!target;
  el('guide-why').textContent=why;
  if(!target)return;
  const control=el(target);
  control.classList.add('guided-target');
  action.textContent='↓ Show me: '+control.textContent;
  action.onclick=()=>{control.closest('details')?.setAttribute('open','');control.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});control.focus({preventScroll:true});};
}

const milestoneNames=['Work order','NEAR job & invoice','Wallet approval','Solana payout','NEAR receipt'];
let milestoneDone=-1;
function milestone(done,next){
  milestoneDone=Math.max(milestoneDone,done);
  el('payment-milestones').replaceChildren(...milestoneNames.map((name,i)=>{
    const item=document.createElement('li'),title=document.createElement('strong'),state=document.createElement('small');
    title.textContent=(i+1)+'. '+name;state.textContent=i<=milestoneDone?'Confirmed':i===milestoneDone+1?'Current step':'Not yet confirmed';
    item.dataset.state=i<=milestoneDone?'done':'pending';if(i===milestoneDone+1)item.setAttribute('aria-current','step');item.append(title,state);return item;
  }));
  el('payment-next').textContent=next;
  const targets=['connect','link-job','pay','refresh','publish-near'];
  guide(targets[milestoneDone+1],next);

}
milestone(-1,'Connect your wallet, then create or resume your existing work order.');
const providers = [];
const demoMode=new URL(location.href).searchParams.get('localDemo')==='1';
const nearWalletRequest=demoMode?localNearRequest:meteorRequest;
const openNearApproval=()=>demoMode?prepareLocalApproval():window.open('about:blank','SwarmNEAR','popup,width=480,height=720');
let connected;
let currentJob;
let unsubscribe;
let working=false;
let drafts,draftKey=crypto.randomUUID(),draftOwner='',explicitNew=false;
try{drafts=resumeStore(localStorage);}catch{}
function listDrafts(){
 const select=el('saved-jobs');
 select.replaceChildren(...(drafts?.list()||[]).map(row=>new Option((row.fields['job-id']||'New job draft')+(row.fields.invoice?' · '+row.fields.invoice:''),row.key)));
 select.value=draftKey;
}
function saveDraft(){
 try{drafts?.save(draftKey,{owner:connected?.owner||draftOwner,fields:Object.fromEntries(resumeFields.map(id=>[id,el(id).value]))});listDrafts();}
 catch{el('resume-note').textContent='Browser storage is unavailable. Keep your job and invoice IDs to resume on another visit.';}
}
function restoreDraft(row){
 if(!row)return;
 draftKey=row.key;draftOwner=row.owner;explicitNew=!row.fields['job-id'];currentJob=undefined;permissions.clear();
 for(const id of resumeFields)el(id).value=row.fields[id];
 milestoneDone=-1;milestone(-1,'Saved job restored. Reconnect its wallet to verify current chain progress.');
 el('resume-note').textContent='Resuming your saved job. No payment is submitted by restoring this page.';
 listDrafts();
 if(connected)guide('pay','Resume the saved invoice to reconcile confirmed transactions before signing anything new.');
}
for(const id of resumeFields)el(id).addEventListener('input',saveDraft);
window.addEventListener('pagehide',saveDraft);
el('new-job').onclick=()=>{
 if(working)return;saveDraft();draftKey=crypto.randomUUID();draftOwner=connected?.owner||'';explicitNew=true;currentJob=undefined;permissions.clear();
 for(const id of resumeFields)el(id).value='';
 el('budget').value='0.1';el('cap').value='0.025';milestoneDone=-1;
 milestone(-1,'New job draft. Your previous jobs remain in Saved jobs.');
 el('resume-note').textContent='New job draft — no funds moved. Previous jobs remain available.';
 guide(connected?'create':'connect','Set the new job terms, then sign them.');saveDraft();
};
el('resume-job').onclick=()=>{if(working)return;const selected=el('saved-jobs').value;saveDraft();explicitNew=false;restoreDraft(drafts?.select(selected));};
restoreDraft(drafts?.load());

for(const field of ['job-id','invoice'])el(field).addEventListener('input',()=>{milestoneDone=-1;milestone(-1,'Resume this invoice to verify its saved progress.');if(connected)guide(el('job-id').value&&el('invoice').value?'pay':'read','Resume the same job to verify saved progress before any new payment.');});
function forgetWallet() {
  permissions.clear();
  unsubscribe?.();
  unsubscribe=undefined;
  connected=undefined;
  el('connect').textContent='Connect wallet';
  // Retain the draft when the wallet disconnects.
  el('order-result').textContent='';
  currentJob=undefined;el('settlement-result').textContent='';milestoneDone=-1;milestone(-1,'Connect the wallet that owns this work order.');
}
function renderProviders() {
  const select=el('wallet');
  select.replaceChildren(...providers.map((w,i)=>new Option(w.name,String(i))));
  if(connected?.provider && providers.includes(connected.provider))select.value=String(providers.indexOf(connected.provider));
  const injected=window.phantom?.solana || window.solana;
  if (injected?.signMessage && !providers.length) select.add(new Option('Solana wallet','injected'));
  select.hidden = select.options.length <= 1;
}
const register = (...wallets) => {
  const added=wallets.filter(w=>w?.features?.['standard:connect'] && w.features['solana:signMessage'] && !providers.includes(w));
  providers.push(...added);
  renderProviders();
  return ()=>{
    if(added.includes(connected?.provider))forgetWallet();
    for(const wallet of added){const index=providers.indexOf(wallet);if(index>=0)providers.splice(index,1);}
    renderProviders();
  };
};
el('wallet').addEventListener('change',forgetWallet);
window.addEventListener('wallet-standard:register-wallet', e=>e.detail({register}));
window.dispatchEvent(new CustomEvent('wallet-standard:app-ready',{detail:{register}}));
register();
if(demoMode){
  const wallet=localDemoWallet(info=>{el('near-owner').value=info.near;});
  register(wallet);el('wallet').value=String(providers.indexOf(wallet));
  el('link-job').textContent='Create NEAR job';
}

async function connect() {
  const selected=providers[Number(el('wallet').value)];
  const previousOwner=connected?.owner;
  if (selected) {
    const {accounts} = await selected.features['standard:connect'].connect();
    const account=accounts.find(a=>a.chains.includes('solana:mainnet') && a.features.includes('solana:signMessage'));
    if (!account) throw Error('Select an account that supports Solana message signing.');
    unsubscribe?.();
    connected={owner:account.address,provider:selected,signAll:selected.features['solana:signTransaction']?async transactions=>{
      const results=await selected.features['solana:signTransaction'].signTransaction(...transactions.map(transaction=>({account,chain:'solana:mainnet',transaction})));
      if(results.length!==transactions.length)throw Error('Wallet returned an incomplete transaction batch.');
      return results.map(result=>result.signedTransaction);
    }:undefined,signTx:selected.features['solana:signTransaction']?async transaction=>{
      const [result]=await selected.features['solana:signTransaction'].signTransaction({account,chain:'solana:mainnet',transaction});
      return result.signedTransaction;
    }:undefined,sign:async message=>{
      const [result]=await selected.features['solana:signMessage'].signMessage({account,message});
      if (!result || result.signedMessage.length!==message.length || !message.every((x,i)=>x===result.signedMessage[i])) throw Error('Wallet returned a different message.');
      return result.signature;
    }};
    unsubscribe=selected.features['standard:events']?.on('change',event=>{
      if(event.accounts && !event.accounts.some(a=>a.address===account.address && a.chains.includes('solana:mainnet') && a.features.includes('solana:signMessage')))forgetWallet();
    });
  } else {
    const wallet=window.phantom?.solana || window.solana;
    if (!wallet?.connect || !wallet.signMessage) throw Error('Open this page in a Solana wallet browser or connect a compatible browser extension.');
    const {publicKey}=await wallet.connect();
    unsubscribe?.();
    connected={owner:publicKey.toString(),provider:wallet,sign:async message=>(await wallet.signMessage(message,'utf8')).signature};
    const changed=key=>{if(key?.toString()!==publicKey.toString())forgetWallet();};
    wallet.on?.('accountChanged',changed);
    wallet.on?.('disconnect',forgetWallet);
    unsubscribe=()=>{wallet.removeListener?.('accountChanged',changed);wallet.removeListener?.('disconnect',forgetWallet);};
  }
  el('connect').textContent=connected.owner.slice(0,5)+'…'+connected.owner.slice(-5);
  if(previousOwner && previousOwner!==connected.owner)el('job-id').value='';
  if(draftOwner&&draftOwner!==connected.owner){forgetWallet();throw Error('Reconnect the wallet that owns the saved job, or choose Start a new job.');}
  if(!explicitNew&&!el('job-id').value){
    try {el('job-id').value=localStorage.getItem('near-swarm-job:'+connected.owner)||'';} catch { /* Optional browser storage. */ }
  }
  guide(el('job-id').value?(el('invoice').value?'pay':'read'):'create',el('job-id').value?'Resume your saved work order so we can verify what is already complete.':'Sign the work order to set the agent, budget and spending limit. This message does not move funds.');
  saveDraft();
  return connected;
}
function lamports(id) {
  const s=el(id).value.trim();
  if(!/^\d{1,9}(?:\.\d{1,9})?$/.test(s)) throw Error('Use a positive SOL amount with at most nine decimals.');
  const [n,f='']=s.split('.');
  return (BigInt(n)*1000000000n + BigInt(f.padEnd(9,'0'))).toString();
}
async function post(path,body) {
  const r=await fetch('/near-swarm/api/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const json=await r.json(); if(r.ok&&path==='settlement'){if(json.summary)milestone(1,'Review the remaining transactions in your wallet. Confirmed funding is retained.');if(json.status==='batch-stored')milestone(2,'Your signed batch is saved. Transactions are being submitted in order.');if(json.status==='submitted')milestone(2,'Transactions submitted. Choose Check settlement to verify final delivery.');if(json.status==='payout-confirmed')milestone(3,'Payout verified. Choose Record settlement on NEAR.');if(json.near?.status==='confirmed'&&json.status==='payout-confirmed')milestone(4,'Payout and NEAR settlement receipt are verified.');if(json.status==='recovery-credit-confirmed')el('payment-next').textContent='Refund verified. Choose Record settlement on NEAR to record the refund.';} if(!r.ok){const error=new Error(json.error || 'Service unavailable.');error.status=r.status;throw error;}return json;
}
function button(id,output,fn) {
  el(id).onclick=async()=>{
    if(working)return;working=true;
    const buttons=document.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
    el(output).textContent='Working…';
    try {
      // Keep one approval window opened by the user's gesture across asynchronous
      // NEAR/Solana signature steps. Never open a second popup after an await.
      if(demoMode&&id!=='verify'&&providers[Number(el('wallet').value)]?.name==='Dedicated demo wallet')prepareLocalApproval();
      el(output).textContent=await fn();
    } catch(e){el(output).textContent=e.message;if(output==='settlement-result'){el('payment-next').textContent='Paused: '+e.message+' Your saved invoice remains unchanged; do not create another payment.';guide('refresh','Check the saved invoice before taking any further payment action. No new funding is needed to check its status.');}}
    finally{saveDraft();working=false;buttons.forEach(b=>b.disabled=b.dataset.unavailable==='true');}
  };
}
button('connect','order-result',async()=>{const w=await connect();return 'Connected '+w.owner;});
for(const action of ['create','read','close']) button(action,'order-result',async()=>{
  const wallet=connected||await connect();
  if(action==='close'&&currentJob?.near&&currentJob.owner===wallet.owner&&currentJob.id===el('job-id').value.trim()){
    const popup=openNearApproval();
    try{await withNearApproval(await authorize('close-near',{}),popup);currentJob.state='closed';return 'Job closed on NEAR. Existing payments can still be reconciled or recovered.';}
    finally{popup?.close();}
  }
  let id=el('job-id').value.trim();
  if (!id && action==='create') id=crypto.randomUUID();
  if (!id) throw Error('Enter the job ID or create a job first.');
  el('job-id').value=id;saveDraft();
  const body={id,action,owner:wallet.owner,expires:Date.now()+240000};
  if(action==='create') Object.assign(body,{recipient:el('recipient').value.trim(),budget:lamports('budget'),limit:lamports('cap')});
  const msg=signedMessage(location.origin,body);
  el('order-result').textContent='Review the work order in your wallet.';
  const sig=await wallet.sign(new TextEncoder().encode(msg));
  if(wallet!==connected)throw Error('Your wallet account changed. Review the order with the current account.');
  body.signature=Array.from(sig,v=>v.toString(16).padStart(2,'0')).join('');
  const {job}=await post('orders',body);
  try {localStorage.setItem('near-swarm-job:'+wallet.owner,id);} catch { /* The signed order is already saved by the service. */ }
  if(wallet!==connected)return 'Order saved for the wallet that signed it.';
  currentJob={...job,owner:wallet.owner};milestoneDone=-1;milestone(0,job.near?'NEAR job linked. Resume your existing invoice.':'Next: create and link the NEAR job.');
  const recent=job.recentInvoices?.find(i=>i.invoice===el('invoice').value)||job.recentInvoices?.[0];
  if(recent?.outcome==='payout-confirmed'){milestone(3,'Saved payout verified. Check or record the NEAR receipt; do not fund again.');guide('publish-near','Your saved payout is confirmed. Reconcile its NEAR receipt.');}
  if(recent?.outcome==='recovery-credit-confirmed'){milestone(3,'Saved refund verified. Check or record its NEAR receipt.');guide('publish-near','Your saved refund is confirmed. Reconcile its NEAR receipt.');}
  if(job.near){el('near-owner').value=job.near.account;el('near-id').value=job.near.jobId;}
  if(recent&&!el('invoice').value)el('invoice').value=recent.invoice;
  return 'Job '+job.id+' · '+job.state+' · budget '+job.budget+' lamports · per payment '+job.cap+' lamports.'+(job.near?' Linked NEAR job '+job.near.jobId+'.':'')+(recent?' Latest invoice '+recent.invoice+' · '+(recent.outcome||'awaiting settlement')+'.':'');
});
button('verify','receipt-result',async()=>{
  const signature=el('signature').value.trim(),routeId=el('route').value.trim().toLowerCase();
  let v;
  try {v=await post('screening',{signature,routeId});}
  catch(error) {
    if(error.status!==503)throw error;
    v=await lookupReceipt(signature,routeId);
  }
  return v.screening+' at finalized slot '+v.slot+'. Covers the '+v.coverage.toLowerCase()+'.';
});

const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const b64=bytes=>btoa(String.fromCharCode(...bytes));
function activeJob(){
  if(!connected||currentJob?.owner!==connected.owner||currentJob.id!==el('job-id').value.trim())throw Error('Create or view the work order first with the wallet that owns it.');
  return currentJob;
}
async function authorize(action,fields){
  const wallet=connected;
  const job=action==='wallet-run'?{id:el('job-id').value.trim()}:activeJob();
  if(!wallet)throw Error('Connect the wallet that owns this work order.');
  const body={owner:wallet.owner,id:job.id,action,expires:Date.now()+285000,...fields};
  return permissions.get(body,async()=>{
    guide(null,'Review the scoped authorization in your wallet. It allows only this invoice and budget; it does not transfer funds.');
    body.signature=hex(await wallet.sign(new TextEncoder().encode(signedMessage(location.origin,body))));
    if(connected!==wallet)throw Error('Your wallet account changed.');
    return body;
  });
}
async function approveNearOperation(plan,popup) {
  const result=await nearWalletRequest('sign',{transactions:plan.transaction},popup);
  const outcomes=result?.executionOutcomes;
  if(!Array.isArray(outcomes)||outcomes.length!==1)throw Error('The NEAR wallet did not return one transaction. Resume this invoice to reconcile it.');
  const hash=outcomes[0]?.transaction?.hash;
  fromBase58(hash,32);
  return hash;
}
async function withNearApproval(body,popup){
  let result=await post('settlement',body);
  if(result.status!=='near-approval-required'){popup?.close();return result;}
  const hash=await approveNearOperation(result,popup);
  for(let attempt=0;attempt<12;attempt++){
    result=await post('settlement',{...body,nearTransactionHash:hash});
    if(result.status!=='near-approval-required'){
      const link=document.createElement('a');link.href='https://nearblocks.io/txns/'+hash;
      link.target='_blank';link.rel='noopener noreferrer';link.textContent='View the confirmed NEAR operation';
      el('chain-evidence').append(link,document.createElement('br'));
      return result;
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw Error('NEAR finality is still pending. Resume this job or invoice to check again.');
}
button('link-job','settlement-result',async()=>{
  const job=activeJob(), nearOwner=el('near-owner').value.trim(), nearJobId=el('near-id').value.trim();
  const body={owner:connected.owner,id:job.id,action:'link',expires:Date.now()+285000,nearOwner,nearJobId};
  signedMessage(location.origin,body);
  const wallet=connected,nonce=crypto.getRandomValues(new Uint8Array(32));
  const popup=openNearApproval();
  const proof=await nearWalletRequest('sign_message',{message:nearMessage(location.origin,body,job),nonce,
    recipient:location.host,accountId:nearOwner},popup);
  if(!proof||proof.accountId!==nearOwner||wallet!==connected)throw Error('Select the NEAR account and Solana wallet named in this order.');
  body.nearProof={accountId:proof.accountId,publicKey:proof.publicKey,signature:proof.signature,nonce:hex(nonce)};
  body.signature=hex(await wallet.sign(new TextEncoder().encode(signedMessage(location.origin,body))));
  try{const result=await withNearApproval(body,popup);currentJob.near={account:result.nearAccount,jobId:result.nearJobId,jobKey:result.jobKey};guide('quote','Reserve this invoice against the NEAR job budget before paying the agent.');return 'Linked '+result.nearAccount+' / '+result.nearJobId+' to this work order.';}finally{popup?.close();}
});
function invoiceId(){const id=el('invoice').value.trim();if(!id)throw Error('Enter an invoice ID.');return id;}
function pretty(row){
  const base='Invoice '+row.invoice+' · '+row.status;
  if(row.creditedLamports)return base+' · '+row.creditedLamports+' lamports credited · '+row.transactions.map(t=>t.signature).join(', ');
  if(row.quotedNetLamports)return base+' · gross '+row.grossLamports+' lamports · agent receives '+row.quotedNetLamports+' lamports'+(row.phase?' · '+row.phase:'');
  return base;
}
button('quote','settlement-result',async()=>{
  activeJob();
  const popup=openNearApproval();
  try{const result=await withNearApproval(await authorize('invoice',{invoice:invoiceId(),recipient:activeJob().recipient,amount:lamports('amount'),minimum:lamports('minimum')}),popup);guide('pay','Approve the invoice payment. The app reconciles previous funding before requesting any remaining signatures.');return pretty(result);}
  finally{popup?.close();}
});
button('publish-near','settlement-result',async()=>{
  activeJob();
  const popup=openNearApproval();
  try{const result=await withNearApproval(await authorize('publish-receipt',{invoice:invoiceId()}),popup);
    return pretty(result)+(result.near?.status==='confirmed'?' · Settlement recorded on NEAR.':'');}
  finally{popup?.close();}
});
button('cancel-job','settlement-result',async()=>{
 activeJob();const result=await post('settlement',await authorize('cancel-job',{}));currentJob.state='closed';
 const eligible=result.recovery.filter(r=>r.canRecover);
 guide(eligible.length?'refund':null,eligible.length?'Recovery is available for invoice '+eligible.map(r=>r.invoice).join(', ')+'. Select that invoice and recover its remaining funds.':result.note);
 return result.note+' '+result.recovery.map(r=>r.invoice+': '+r.status).join('; ');
});
for(const action of ['share-receipt','revoke-receipt'])button(action,'settlement-result',async()=>{
 activeJob();const result=await post('receipt-share',await authorize(action,{invoice:invoiceId()}));
 if(result.url){const a=document.createElement('a');a.href=result.url;a.textContent='Open shareable settlement receipt';a.target='_blank';a.rel='noopener';el('chain-evidence').replaceChildren(a);}
 return result.url?'Receipt shared: '+result.url:'Share link revoked. Existing copies and blockchain history remain public.';
});
button('close-near','settlement-result',async()=>{
  activeJob();
  const popup=openNearApproval();
  try{await withNearApproval(await authorize('close-near',{}),popup);currentJob.state='closed';return 'NEAR job closed. Existing payments can still be reconciled or recovered.';}
  finally{popup?.close();}
});
button('refresh','settlement-result',async()=>pretty(await post('settlement',await authorize('refresh',{invoice:invoiceId()}))));
for(const [buttonId,mode] of [['pay','payment'],['refund','recovery']])button(buttonId,'settlement-result',async()=>{
  const wallet=connected||await connect(),job=wallet.signAll?{id:el('job-id').value.trim()}:activeJob();if(!wallet.signTx)throw Error('Connect a Solana Wallet Standard wallet with transaction signing.');
  const fields={mode,invoice:invoiceId(),extra:lamports('extra')};
  function unchanged(){
    if(wallet!==connected||job.id!==el('job-id').value.trim())throw Error('Work order or wallet changed.');
  }
  const result=wallet.signAll?await runBatchPayment({
    authorize:async action=>{unchanged();return authorize(action,fields);},
    request:async body=>{unchanged();return post('settlement',body);},
    signAll:async transactions=>{unchanged();return (await wallet.signAll(transactions.map(bytes=>Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))))).map(b64);},
    onProgress:text=>{el('settlement-result').textContent=text;el('payment-next').textContent=text;guide(null,text+' Keep this page open. Previously confirmed funding will not be repeated.');},
    onSummary:summary=>{currentJob={...summary.job,id:job.id,owner:wallet.owner};el('recipient').value=summary.job.recipient;}
  }):await runPayment({
    authorize:async action=>{unchanged();return authorize(action,fields);},
    prepare:async authorization=>{unchanged();return post('settlement',authorization);},
    submit:async(permission,index,signedTx)=>{unchanged();return post('settlement',{...permission,step:index,...(signedTx?{signedTx}:{})});},
    sign:async bytes=>{unchanged();return b64(await wallet.signTx(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))));},
    onReview:(i,count)=>{el('settlement-result').textContent='Reviewing '+mode+' transaction '+(i+1)+' of '+count+'.';}
  });
  if(result.status!=='submitted')return pretty(result);
  return 'Wallet transactions submitted. Use Check settlement to verify final delivery or the recovered balance.';
});

let availabilityKnown=false;
async function showAvailability(){
  if(working)return;
  const buttons=[el('pay'),el('refund')];
  // A background health refresh must not briefly disable a working Pay button.
  // The server still checks the actual invoice before accepting any payment.
  if(!availabilityKnown)for(const b of buttons){b.disabled=true;b.dataset.unavailable='true';}
  try{
    const response=await fetch('/near-swarm/api',{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error();
    const capabilities=await response.json();
    if(working)return;
    availabilityKnown=true;
    for(const [i,available] of [capabilities.fundedPayments,capabilities.refunds].entries()){
      buttons[i].disabled=!available;buttons[i].dataset.unavailable=String(!available);
    }
    el('payment-availability').textContent=capabilities.fundedPayments?'Your Solana wallet reviews each payment before submission.':'Live payments require the registered Solana provider and the deployed NEAR job contract. Work-order signing is available.';
  }catch{
    if(working)return;
    availabilityKnown=true;
    for(const b of buttons){b.disabled=true;b.dataset.unavailable='true';}
    el('payment-availability').textContent='The connection is temporarily unavailable. Reconnecting automatically; your saved invoice is unchanged.';
  }
}
showAvailability();
setInterval(showAvailability,30000);
