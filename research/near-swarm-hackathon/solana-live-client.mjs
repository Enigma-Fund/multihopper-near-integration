// Isolated integration adapter. No server route or live credentials are wired here.
// Wallet signing, transaction verification and custody reconciliation remain separate gates.
const ID=/^[0-9]{1,20}$/;
const KEY=/^[A-Za-z0-9_-]{8,100}$/;
const WALLET=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export class SolanaLiveClient {
 constructor({baseUrl,expectedOrigin,apiKey,owner,journal,fetchImpl=fetch}) {
  const url=new URL(baseUrl),expected=new URL(expectedOrigin);
  if(url.protocol!=='https:' || expected.origin!==url.origin || expected.pathname!=='/' || expected.username||expected.password||expected.search||expected.hash || url.username||url.password||url.search||url.hash)throw Error('Explicit HTTPS API origin required');
  if(typeof apiKey!=='string'||!apiKey.startsWith('mh_live_'))throw Error('Live API key required');
  if(typeof owner!=='string'||!WALLET.test(owner))throw Error('Valid source wallet required');
  if(!journal || typeof journal.run!=='function')throw Error('Operation journal required');
  this.url=url;this.key=apiKey;this.owner=owner;this.journal=journal;this.fetch=fetchImpl;
 }
 id(id){id=String(id);if(!ID.test(id))throw Error('Invalid transfer ID');return id;}
 async request(method,path,body,key,{rescueBundle=false}={}){
  if(method==='POST' && (typeof key!=='string'||!KEY.test(key)))throw Error('Stable idempotency key required');
  const u=new URL(this.url);u.pathname=this.url.pathname.replace(/\/$/,'')+path;
  const headers={'x-api-key':this.key,accept:'application/json'};
  if(method==='POST'){headers['content-type']='application/json';headers['idempotency-key']=key;}
  const send=async()=>{const r=await this.fetch(u,{method,headers,...(method==='POST'?{body:JSON.stringify(body??{})}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});const text=await r.text();if(!r.ok||text.length>1000000)throw Error('Solana API request failed');let result;try{result=JSON.parse(text);}catch{throw Error('Invalid Solana API response');}if(rescueBundle){if(!Array.isArray(result?.rescueTxs)||!result.rescueTxs.length||result.rescueTxs.some(x=>typeof x?.base64!=='string')||typeof result.recentBlockhash!=='string'||!Number.isSafeInteger(result.lastValidBlockHeight))throw Error('Invalid rescue bundle');}else{const transfer=result.transfer??result;if(!transfer || transfer.sourceOwner!==this.owner || transfer.isTest!==false)throw Error('Transfer ownership or environment mismatch');}return result;};
  return method==='POST'?this.journal.run({key,owner:this.owner,method,path:u.pathname,body:body??{}},send):send();
 }
 create(input,key){if(!input || input.sourceOwner!==this.owner)throw Error('Authenticated source wallet required');return this.request('POST','/transfers',input,key);}
 async prepare(id,key){id=this.id(id);await this.status(id);return this.request('POST',`/transfers/${id}/prepare`,{},key);}
 status(id){return this.request('GET',`/transfers/${this.id(id)}`);}
 async confirm(id,signatures,key){id=this.id(id);await this.status(id);return this.request('POST',`/transfers/${id}/confirm-broadcast`,signatures,key);}
 async prepareRescue(id,key){id=this.id(id);const transfer=await this.status(id);if(transfer.status!=='failed')throw Error('Failed transfer required for rescue');return this.request('POST',`/transfers/${id}/rescue/prepare`,{},key,{rescueBundle:true});}
 async confirmRescue(id,signatures,key){id=this.id(id);const transfer=await this.status(id);if(transfer.status!=='failed')throw Error('Failed transfer required for rescue');if(!Array.isArray(signatures)||!signatures.length||signatures.some(x=>typeof x!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(x)))throw Error('Valid rescue signatures required');return this.request('POST',`/transfers/${id}/rescue/confirm`,{rescueSignatures:signatures},key);}
}
