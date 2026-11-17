// Opt-in bridge to the owner's human-operated Keychain wallet on this computer.
// Ordinary visitors continue to use their browser wallet. No private keys cross this bridge.
import {fromBase58} from './orders.mjs';
export const LOCAL_DEMO_ORIGIN='http://127.0.0.1:18871';
const encode=bytes=>btoa(String.fromCharCode(...bytes));
const decode=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const approvalWindows=new WeakMap();
export function prepareLocalApproval(popup,{host=window}={}){
  const saved=approvalWindows.get(host);
  popup=popup&&!popup.closed?popup:saved&&!saved.closed?saved:host.open('about:blank','SwarmDemoWallet','popup,width=760,height=800');
  if(!popup)throw Error('Allow the local wallet approval window.');
  approvalWindows.set(host,popup);
  return popup;
}
export function localRequest(kind,inputs={},popup,{host=window,timeout=240000}={}){
  popup=prepareLocalApproval(popup,{host});
  const uid=crypto.randomUUID();let timer;
  return new Promise((resolve,reject)=>{
    const until=Date.now()+timeout;
    const done=(fn,value)=>{clearInterval(timer);host.removeEventListener('message',receive);fn(value);};
    function receive(event){if(event.source!==popup||event.origin!==LOCAL_DEMO_ORIGIN||event.data?.uid!==uid)return;
      if(event.data.error)done(reject,Error(event.data.error));else if(event.data.result)done(resolve,event.data.result);}
    host.addEventListener('message',receive);
    popup.location.href=LOCAL_DEMO_ORIGIN+'/?uid='+uid;
    timer=setInterval(()=>{
      if(popup.closed||Date.now()>until)return done(reject,Error('Local approval closed or timed out. Resume the same invoice to check its saved transaction.'));
      popup.postMessage({uid,kind,inputs},LOCAL_DEMO_ORIGIN);
    },300);
  });
}
export function localDemoWallet(onInfo){
  let account;
  return {name:'Dedicated demo wallet',version:'1.0.0',chains:['solana:mainnet'],get accounts(){return account?[account]:[];},features:{
    'standard:connect':{version:'1.0.0',async connect(){const info=await localRequest('connect');fromBase58(info.solana,32);
      account={address:info.solana,publicKey:fromBase58(info.solana,32),chains:['solana:mainnet'],features:['solana:signMessage','solana:signTransaction']};onInfo?.(info);return {accounts:[account]};}},
    'solana:signMessage':{version:'1.0.0',async signMessage(...requests){const outputs=[];for(const r of requests){if(r.account!==account)throw Error('Wrong demo account');
      const signed=await localRequest('solana-message',{message:encode(r.message)});outputs.push({signedMessage:r.message,signature:decode(signed.signature)});}return outputs;}},
    'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:['legacy',0],async signTransaction(...requests){
      if(!requests.length||requests.length>12||requests.some(r=>r.account!==account||r.chain!=='solana:mainnet'))throw Error('Wrong account, chain or batch size');
      const result=await localRequest('solana-batch',{transactions:requests.map(r=>encode(r.transaction))});
      if(!Array.isArray(result.signedTransactions)||result.signedTransactions.length!==requests.length)throw Error('Incomplete wallet batch');
      return result.signedTransactions.map(bytes=>({signedTransaction:decode(bytes)}));}}
  }};
}
export function localNearRequest(action,inputs,popup){
  return localRequest(action==='sign'?'near-sign':'near-sign-message',
    action==='sign'?inputs:{...inputs,nonce:Array.from(inputs.nonce)},popup);
}
