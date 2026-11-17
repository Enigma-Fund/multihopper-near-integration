// Local-only NEAR client; Node built-ins, no wallet SDK/config or external RPC.
import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const sha=b=>createHash('sha256').update(b).digest();
export function base58(b){let n=BigInt('0x'+(Buffer.from(b).toString('hex')||'0')),s='';while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const x of b){if(x!==0)break;s='1'+s;}return s;}
export function unbase58(s){let n=0n;for(const c of s){const i=alphabet.indexOf(c);if(i<0)throw Error('invalid base58');n=n*58n+BigInt(i);}let h=n.toString(16);if(h.length%2)h='0'+h;const bytes=n?Buffer.from(h,'hex'):Buffer.alloc(0);return Buffer.concat([Buffer.alloc(s.match(/^1*/)[0].length),bytes]);}
// Deliberately public deterministic fixture seeds. NEVER valid production key management.
export function key(account){return keyFromSeed(sha(Buffer.from('MULTIHOPPER_SYNTHETIC_SANDBOX_ONLY/v1/'+account)));}
export function keyFromSeed(seed){const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});const pub=createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32);return {privateKey,pub,publicKey:'ed25519:'+base58(pub)};}
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const u128=n=>{n=BigInt(n);return Buffer.concat([u64(n&((1n<<64n)-1n)),u64(n>>64n)]);};
const bytes=b=>Buffer.concat([u32(b.length),b]);
const string=s=>bytes(Buffer.from(s));
export const actions={
 create:()=>Buffer.from([0]),
 deploy:wasm=>Buffer.concat([Buffer.from([1]),bytes(wasm)]),
 call:(method,args,deposit='0')=>Buffer.concat([Buffer.from([2]),string(method),bytes(Buffer.from(JSON.stringify(args))),u64(100_000_000_000_000n),u128(deposit)]),
 transfer:amount=>Buffer.concat([Buffer.from([3]),u128(amount)]),
 addPublicKey:pub=>Buffer.concat([Buffer.from([5,0]),pub,u64(0),Buffer.from([1])]),
 addKey:account=>Buffer.concat([Buffer.from([5,0]),key(account).pub,u64(0),Buffer.from([1])]),
};
export class RpcError extends Error {constructor(message,final=false){super(message);this.final=final;}}
export class LocalNear {
 constructor(port,chainId){if(!Number.isInteger(port)||port<1024||!chainId.startsWith('mh-synthetic-'))throw Error('local sandbox configuration required');Object.defineProperty(this,'url',{value:`http://127.0.0.1:${port}`,writable:false});this.chainId=chainId;this.locks=new Map();this.receipts=[];}
 async rpc(method,params){if(!['status','query','send_tx','tx'].includes(method))throw Error('RPC method not allowlisted');let response;try{response=await fetch(this.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'synthetic',method,params}),signal:AbortSignal.timeout(30000)});}catch(e){throw new RpcError('local RPC unavailable: '+e.message);}
 const data=await response.json();if(data.error)throw new RpcError(['RPC',data.error.name,data.error.cause?.name,data.error.message].filter(Boolean).join(' '));if(data.result?.error)throw new RpcError(JSON.stringify(data.result.error));return data.result;}
 async verify(){const s=await this.rpc('status',[]);if(s.chain_id!==this.chainId)throw Error('wrong chain identity; signing disabled');return s;}
 async view(contract,method,args){await this.verify();const r=await this.rpc('query',{request_type:'call_function',account_id:contract,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64'),finality:'final'});return JSON.parse(Buffer.from(r.result).toString());}
 async send(signer,receiver,list){
 const before=this.locks.get(signer)||Promise.resolve();let release;const gate=new Promise(r=>release=r);this.locks.set(signer,gate);await before;
 try{await this.verify();const k=key(signer);const access=await this.rpc('query',{request_type:'view_access_key',finality:'final',account_id:signer,public_key:k.publicKey});
 if(access.nonce===undefined||!access.block_hash)throw new RpcError('access key unavailable; signing disabled');
 const tx=Buffer.concat([string(signer),Buffer.from([0]),k.pub,u64(BigInt(access.nonce)+1n),string(receiver),unbase58(access.block_hash),u32(list.length),...list]);
 const signature=sign(null,sha(tx),k.privateKey);const encoded=Buffer.concat([tx,Buffer.from([0]),signature]).toString('base64');
 const result=await submitExact(this,{encoded,hash:base58(sha(tx)),signer});
 this.receipts.push({signer,receiver,hash:result.transaction?.hash,status:result.status,receipts:(result.receipts_outcome||[]).map(x=>({id:x.id,status:x.outcome.status,gasBurnt:x.outcome.gas_burnt,tokensBurnt:x.outcome.tokens_burnt}))});
 if(result.final_execution_status!=='FINAL')throw new RpcError('receipt finality not established');
 if(result.status.Failure)throw new RpcError(JSON.stringify(result.status.Failure),true);
 if(!Object.hasOwn(result.status,'SuccessValue'))throw new RpcError('settlement not final');
 const value=Buffer.from(result.status.SuccessValue,'base64').toString();return value?JSON.parse(value):null;
 }finally{release();}}
 call(signer,contract,method,args,deposit='0'){return this.send(signer,contract,[actions.call(method,args,deposit)]);}
}

// Internal local-provider primitive. Never expose its output through provider RPC.
export async function prepareExact(rpc,signer,receiver,list,k) {
 await rpc.verify();
 const access=await rpc.rpc('query',{request_type:'view_access_key',finality:'final',account_id:signer,public_key:k.publicKey});
 if(access.nonce===undefined||!access.block_hash)throw new RpcError('access key unavailable; signing disabled');
 const tx=Buffer.concat([string(signer),Buffer.from([0]),k.pub,u64(BigInt(access.nonce)+1n),string(receiver),unbase58(access.block_hash),u32(list.length),...list]);
 return {signer,receiver,hash:base58(sha(tx)),encoded:Buffer.concat([tx,Buffer.from([0]),sign(null,sha(tx),k.privateKey)]).toString('base64')};
}

// A node may time out waiting for FINAL after accepting a transaction. Never re-sign it.
export async function submitExact(rpc,tx) {
 let broadcast=true;
 for(let attempt=0;attempt<8;attempt++) {
  await rpc.verify();
  try {
   const r=broadcast?await rpc.rpc('send_tx',{signed_tx_base64:tx.encoded,wait_until:'FINAL'}):await rpc.rpc('tx',{tx_hash:tx.hash,sender_account_id:tx.signer,wait_until:'FINAL'});
   if(r.final_execution_status==='FINAL')return r;
   broadcast=false;
  } catch(e) {
   if(/UNKNOWN_TRANSACTION/.test(e.message))broadcast=true;
   else if(/TIMEOUT|Timeout|RPC unavailable/.test(e.message))broadcast=false;
   else throw e;
  }
 }
 throw new RpcError('exact transaction outcome unknown; original signature retained');
}
