// Research-only client for MultiHopper's devnet API. The customer must review,
// sign and broadcast prepared Solana transactions in their own wallet. This
// module does not itself sign transactions or manage customer funds.
const DEVNET_ORIGIN='https://multihopper-devnet-7ef159532254.herokuapp.com';
const ID=/^[0-9]{1,20}$/;
const KEY=/^[A-Za-z0-9_-]{8,100}$/;
export class SolanaTestClient {
  constructor({baseUrl,apiKey,journal,owner,fetchImpl=fetch}) {
    const base=new URL(baseUrl);
    const local=base.protocol==='http:' && ['127.0.0.1','localhost'].includes(base.hostname);
    if (!(base.origin===DEVNET_ORIGIN || local) || base.username || base.password || base.search || base.hash) throw Error('Devnet or local API required');
    if(typeof apiKey!=='string'||!apiKey.startsWith('mh_test_')) throw Error('Test API key required');
    if(!journal || typeof journal.run!=='function' || typeof owner!=='string' || !owner) throw Error('Operation journal and wallet owner required');
    this.base=base;this.apiKey=apiKey;this.fetch=fetchImpl;this.journal=journal;this.owner=owner;
  }
  async request(method,path,body,key) {
    if(method==='POST' && (typeof key!=='string'||!KEY.test(key))) throw Error('Stable idempotency key required');
    const url=new URL(this.base);url.pathname=this.base.pathname.replace(/\/$/,'')+path;
    const headers={'x-api-key':this.apiKey,accept:'application/json'};
    if(method==='POST'){headers['content-type']='application/json';headers['idempotency-key']=key;}
    const send=async()=>{
      const response=await this.fetch(url,{method,headers,...(method==='POST'?{body:JSON.stringify(body??{})}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
      const text=await response.text();if(text.length>1000000)throw Error('API response too large');
      if(!response.ok)throw Error('Solana test API request failed');
      try{return JSON.parse(text);}catch{throw Error('Invalid Solana test API response');}
    };
    // Persist uncertainty before sending; a lost response cannot trigger a second write.
    return method==='POST' ? this.journal.run({key,owner:this.owner,method,path:url.pathname,body:body??{}},send) : send();
  }
  id(value){const id=String(value);if(!ID.test(id))throw Error('Invalid transfer ID');return id;}
  estimate(input,key){return this.request('POST','/transfers/estimate',input,key);}
  create(input,key){return this.request('POST','/transfers',input,key);}
  prepare(id,key){return this.request('POST',`/transfers/${this.id(id)}/prepare`,{},key);}
  status(id){return this.request('GET',`/transfers/${this.id(id)}`);}
  confirm(id,signatures,key){return this.request('POST',`/transfers/${this.id(id)}/confirm-broadcast`,signatures,key);}
  prepareRecovery(id,key){return this.request('POST',`/transfers/${this.id(id)}/rescue/prepare`,{},key);}
  confirmRecovery(id,signatures,key){return this.request('POST',`/transfers/${this.id(id)}/rescue/confirm`,{rescueSignatures:signatures},key);}
}
