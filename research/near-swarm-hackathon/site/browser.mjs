import {meteorRequest} from '/near-swarm/near-wallet.mjs';
import {localDemoWallet,localNearRequest} from '/near-swarm/local-demo-wallet.mjs';
import {signedMessage,fromBase58} from './orders.mjs';
import {nearMessage} from '/near-swarm/near-job.mjs';
import {lookupReceipt} from '/near-swarm/receipt.mjs';

const el = id => document.getElementById(id);
const providers = [];
const demoMode=new URL(location.href).searchParams.get('localDemo')==='1';
const nearWalletRequest=demoMode?localNearRequest:meteorRequest;
let connected;
let currentJob;
let unsubscribe;
let working=false;
function forgetWallet() {
  unsubscribe?.();
  unsubscribe=undefined;
  connected=undefined;
  el('connect').textContent='Connect wallet';
  el('job-id').value='';
  el('order-result').textContent='';
  currentJob=undefined;el('settlement-result').textContent='';
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
    connected={owner:account.address,provider:selected,signTx:selected.features['solana:signTransaction']?async transaction=>{
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
  if(!el('job-id').value){
    try {el('job-id').value=localStorage.getItem('near-swarm-job:'+connected.owner)||'';} catch { /* Optional browser storage. */ }
  }
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
  const json=await r.json(); if(!r.ok){const error=new Error(json.error || 'Service unavailable.');error.status=r.status;throw error;}return json;
}
function button(id,output,fn) {
  el(id).onclick=async()=>{
    if(working)return;working=true;
    const buttons=document.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
    el(output).textContent='Working…';
    try {el(output).textContent=await fn();} catch(e){el(output).textContent=e.message;}
    finally{working=false;buttons.forEach(b=>b.disabled=b.dataset.unavailable==='true');}
  };
}
button('connect','order-result',async()=>{const w=await connect();return 'Connected '+w.owner;});
for(const action of ['create','read','close']) button(action,'order-result',async()=>{
  const wallet=connected||await connect();
  if(action==='close'&&currentJob?.near&&currentJob.owner===wallet.owner&&currentJob.id===el('job-id').value.trim()){
    const popup=window.open('about:blank','SwarmNEAR','popup,width=480,height=720');
    try{await withNearApproval(await authorize('close-near',{}),popup);currentJob.state='closed';return 'Job closed on NEAR. Existing payments can still be reconciled or recovered.';}
    finally{popup?.close();}
  }
  let id=el('job-id').value.trim();
  if (!id && action==='create') id=crypto.randomUUID();
  if (!id) throw Error('Enter the job ID or create a job first.');
  el('job-id').value=id;
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
  currentJob={...job,owner:wallet.owner};
  const recent=job.recentInvoices?.[0];
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
  const job=activeJob(),wallet=connected;
  const body={owner:wallet.owner,id:job.id,action,expires:Date.now()+285000,...fields};
  body.signature=hex(await wallet.sign(new TextEncoder().encode(signedMessage(location.origin,body))));
  if(connected!==wallet)throw Error('Your wallet account changed.');
  return body;
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
  const popup=window.open('about:blank','SwarmNEAR','popup,width=480,height=720');
  const proof=await nearWalletRequest('sign_message',{message:nearMessage(location.origin,body,job),nonce,
    recipient:location.host,accountId:nearOwner},popup);
  if(!proof||proof.accountId!==nearOwner||wallet!==connected)throw Error('Select the NEAR account and Solana wallet named in this order.');
  body.nearProof={accountId:proof.accountId,publicKey:proof.publicKey,signature:proof.signature,nonce:hex(nonce)};
  body.signature=hex(await wallet.sign(new TextEncoder().encode(signedMessage(location.origin,body))));
  try{const result=await withNearApproval(body,popup);currentJob.near={account:result.nearAccount,jobId:result.nearJobId,jobKey:result.jobKey};return 'Linked '+result.nearAccount+' / '+result.nearJobId+' to this work order.';}finally{popup?.close();}
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
  const popup=window.open('about:blank','SwarmNEAR','popup,width=480,height=720');
  try{return pretty(await withNearApproval(await authorize('invoice',{invoice:invoiceId(),recipient:activeJob().recipient,amount:lamports('amount'),minimum:lamports('minimum')}),popup));}
  finally{popup?.close();}
});
button('publish-near','settlement-result',async()=>{
  activeJob();
  const popup=window.open('about:blank','SwarmNEAR','popup,width=480,height=720');
  try{const result=await withNearApproval(await authorize('publish-receipt',{invoice:invoiceId()}),popup);
    return pretty(result)+(result.near?.status==='confirmed'?' · Settlement recorded on NEAR.':'');}
  finally{popup?.close();}
});
button('close-near','settlement-result',async()=>{
  activeJob();
  const popup=window.open('about:blank','SwarmNEAR','popup,width=480,height=720');
  try{await withNearApproval(await authorize('close-near',{}),popup);currentJob.state='closed';return 'NEAR job closed. Existing payments can still be reconciled or recovered.';}
  finally{popup?.close();}
});
button('refresh','settlement-result',async()=>pretty(await post('settlement',await authorize('refresh',{invoice:invoiceId()}))));
for(const [buttonId,mode] of [['pay','payment'],['refund','recovery']])button(buttonId,'settlement-result',async()=>{
  const wallet=connected,job=activeJob();if(!wallet.signTx)throw Error('Connect a Solana Wallet Standard wallet with transaction signing.');
  const fields={mode,invoice:invoiceId(),extra:lamports('extra')};
  const prepared=await post('settlement',await authorize('prepare-wallet',fields));
  if(prepared.status==='submitted')return 'Already submitted. Choose Check settlement for the finalized receipt.';
  if(!prepared.items) return pretty(prepared);
  let permission=await authorize('wallet-step',fields);
  async function step(index,signedTx){
    if(wallet!==connected||job.id!==el('job-id').value.trim())throw Error('Work order or wallet changed.');
    if(permission.expires<Date.now()+4000)permission=await authorize('wallet-step',fields);
    return post('settlement',{...permission,step:index,...(signedTx?{signedTx}:{})});
  }
  for(const [i,item] of prepared.items.entries()){
    if(item.confirmed)continue;
    el('settlement-result').textContent='Reviewing '+mode+' transaction '+(i+1)+' of '+prepared.items.length+'.';
    const signed=item.pending?undefined:b64(await wallet.signTx(Uint8Array.from(atob(item.bytes),c=>c.charCodeAt(0))));
    let result=await step(i,signed);
    while(result.status==='confirming'){
      await new Promise(resolve=>setTimeout(resolve,1500));
      result=await step(i);
    }
    if(result.status!=='step-confirmed')throw Error('Unexpected transaction status. Check this invoice again.');
  }
  await step(prepared.items.length);
  return 'Wallet transactions submitted. Use Check settlement to verify final delivery or the recovered balance.';
});

async function showAvailability(){
  if(working)return;
  const buttons=[el('pay'),el('refund')];
  for(const b of buttons){b.disabled=true;b.dataset.unavailable='true';}
  try{
    const response=await fetch('/near-swarm/api');if(!response.ok)throw Error();
    const capabilities=await response.json();
    for(const [i,available] of [capabilities.fundedPayments,capabilities.refunds].entries()){
      buttons[i].disabled=!available;buttons[i].dataset.unavailable=String(!available);
    }
    el('payment-availability').textContent=capabilities.fundedPayments?'Your Solana wallet reviews each payment before submission.':'Live payments require the registered Solana provider and the deployed NEAR job contract. Work-order signing is available.';
  }catch{el('payment-availability').textContent='The service is unavailable. Reload to reconnect.';}
}
showAvailability();
setInterval(showAvailability,30000);
