import {signedMessage} from './orders.mjs';
import {screeningReceipt} from '/near-swarm/receipt.mjs';

const el = id => document.getElementById(id);
const providers = [];
let connected;
const register = (...wallets) => {
  for (const wallet of wallets) {
    if (wallet?.features?.['standard:connect'] && wallet.features['solana:signMessage'] && !providers.includes(wallet)) providers.push(wallet);
  }
  const select=el('wallet');
  select.replaceChildren(...providers.map((w,i)=>new Option(w.name,String(i))));
  const injected=window.phantom?.solana || window.solana;
  if (injected?.signMessage && !providers.length) select.add(new Option('Solana wallet','injected'));
  select.hidden = select.options.length <= 1;
  return ()=>{};
};
window.addEventListener('wallet-standard:register-wallet', e=>e.detail({register}));
window.dispatchEvent(new CustomEvent('wallet-standard:app-ready',{detail:{register}}));
register();

async function connect() {
  const selected=providers[Number(el('wallet').value)];
  if (selected) {
    const {accounts} = await selected.features['standard:connect'].connect();
    const account=accounts.find(a=>a.chains.includes('solana:mainnet') && a.features.includes('solana:signMessage'));
    if (!account) throw Error('Select an account that supports Solana message signing.');
    connected={owner:account.address, sign:async message=>{
      const [result]=await selected.features['solana:signMessage'].signMessage({account,message});
      if (!result || result.signedMessage.length!==message.length || !message.every((x,i)=>x===result.signedMessage[i])) throw Error('Wallet returned a different message.');
      return result.signature;
    }};
  } else {
    const wallet=window.phantom?.solana || window.solana;
    if (!wallet?.connect || !wallet.signMessage) throw Error('Open this page in a Solana wallet browser or connect a compatible browser extension.');
    const {publicKey}=await wallet.connect();
    connected={owner:publicKey.toString(),sign:async message=>(await wallet.signMessage(message,'utf8')).signature};
  }
  el('connect').textContent=connected.owner.slice(0,5)+'…'+connected.owner.slice(-5);
  const saved=localStorage.getItem('near-swarm-job:'+connected.owner);
  if (saved) el('job-id').value=saved;
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
    const buttons=document.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
    el(output).textContent='Working…';
    try {el(output).textContent=await fn();} catch(e){el(output).textContent=e.message;}
    finally{buttons.forEach(b=>b.disabled=false);}
  };
}
button('connect','order-result',async()=>{const w=await connect();return 'Connected '+w.owner;});
for(const action of ['create','read','close']) button(action,'order-result',async()=>{
  const wallet=connected||await connect();
  let id=el('job-id').value.trim();
  if (!id && action==='create') id=crypto.randomUUID();
  if (!id) throw Error('Enter the job ID or create a job first.');
  el('job-id').value=id;
  const body={id,action,owner:wallet.owner,expires:Date.now()+240000};
  if(action==='create') Object.assign(body,{recipient:el('recipient').value.trim(),budget:lamports('budget'),limit:lamports('cap')});
  const msg=signedMessage(location.origin,body);
  el('order-result').textContent='Review the work order in your wallet.';
  const sig=await wallet.sign(new TextEncoder().encode(msg));
  body.signature=Array.from(sig,v=>v.toString(16).padStart(2,'0')).join('');
  const {job}=await post('orders',body);localStorage.setItem('near-swarm-job:'+wallet.owner,id);
  return 'Job '+job.id+' · '+job.state+' · budget '+job.budget+' lamports · per payment '+job.cap+' lamports.';
});
button('verify','receipt-result',async()=>{
  const signature=el('signature').value.trim(),routeId=el('route').value.trim().toLowerCase();
  let v;
  try {v=await post('screening',{signature,routeId});}
  catch(error) {
    if(error.status!==503)throw error;
    // Public data only. Some shared RPCs rate-limit data-centre traffic; the
    // browser checks the same finalized transaction against the same program.
    for(const endpoint of ['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com']){
      try{
        v=await screeningReceipt(async(method,params)=>{
          const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(6500)});
          if(!r.ok)throw Error('Solana lookup unavailable');
          const d=await r.json();if(d.error||d.id!==1)throw Error('Solana lookup unavailable');
          return d.result;
        },signature,routeId);
        break;
      }catch(e){error=e;}
    }
    if(!v)throw error;
  }
  return v.screening+' at finalized slot '+v.slot+'. Covers the '+v.coverage.toLowerCase()+'.';
});
