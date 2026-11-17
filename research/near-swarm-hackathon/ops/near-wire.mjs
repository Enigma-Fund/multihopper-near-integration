import {createHash} from 'node:crypto';
import {fromBase58} from '../site/orders.mjs';
export const sha = bytes => createHash('sha256').update(bytes).digest();
export function base58(bytes){
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),s='';
  while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}
  for(const b of bytes){if(b)break;s='1'+s;}return s;
}
const integer=(n,size)=>{n=BigInt(n);if(n<0n||n>=1n<<BigInt(size*8))throw Error('Integer range');const b=Buffer.alloc(size);for(let i=0;i<size;i++){b[i]=Number(n&255n);n>>=8n;}return b;};
const vector=b=>Buffer.concat([integer(b.length,4),b]);
const string=s=>vector(Buffer.from(s));
export function deploymentWire({account,publicKey,nonce,blockHash,wasm,publisher}){
  const args=Buffer.from(JSON.stringify({publisher,network:'mainnet'}));
  const call=Buffer.concat([Buffer.from([2]),string('new'),vector(args),integer(30000000000000n,8),integer(0,16)]);
  return Buffer.concat([string(account),Buffer.from([0]),fromBase58(publicKey.slice(8),32),integer(nonce,8),
    string(account),fromBase58(blockHash,32),integer(2,4),Buffer.from([1]),vector(wasm),call]);
}
export function inspectNear(encoded,config){
  if(typeof encoded!=='string'||encoded.length>700000||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('Invalid transaction bytes');
  const bytes=Buffer.from(encoded,'base64');let at=0;
  const take=n=>{if(n<0||at+n>bytes.length)throw Error('Truncated transaction');const b=bytes.subarray(at,at+n);at+=n;return b;};
  const number=n=>{const b=take(n);let x=0n;for(let i=n-1;i>=0;i--)x=x*256n+BigInt(b[i]);return x;};
  const vec=()=>take(Number(number(4))),str=()=>new TextDecoder('utf-8',{fatal:true}).decode(vec());
  const signer=str();if(number(1)!==0n)throw Error('Ed25519 required');const publicBytes=take(32),nonce=number(8),receiver=str(),blockHash=base58(take(32)),count=Number(number(4));
  if(count<1||count>2)throw Error('Unexpected action count');
  const actions=[];
  for(let i=0;i<count;i++){
    const tag=number(1);
    if(tag===1n){const code=vec();actions.push({kind:'deploy',hash:sha(code).toString('hex'),length:code.length});}
    else if(tag===2n){const method=str(),raw=vec();const args=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),gas=number(8),deposit=number(16);if(gas>30000000000000n)throw Error('Gas limit exceeds 30 Tgas');actions.push({kind:'call',method,args,gas:String(gas),deposit:String(deposit)});}
    else throw Error('This demo does not authorize key changes, transfers or account deletion');
  }
  if(at!==bytes.length||receiver!==config.contract.accountId)throw Error('Wrong contract or trailing bytes');
  const deploy=actions[0].kind==='deploy',identity=deploy?config.contract:config.operator;
  if(signer!==identity.accountId||base58(publicBytes)!==identity.publicKey.slice(8))throw Error('Wrong signer');
  if(deploy){
    if(actions.length!==2||actions[0].hash!==config.wasmSha256||actions[1].method!=='new'||actions[1].deposit!=='0'||
       JSON.stringify(actions[1].args)!==JSON.stringify({publisher:config.publisher,network:'mainnet'}))throw Error('Deployment differs from reviewed build');
  }else{
    const a=actions[0],deposits={create_job:'10000000000000000000000',reserve_invoice:'20000000000000000000000',record_settlement:'0',close_job:'0'};
    if(actions.length!==1||!Object.hasOwn(deposits,a.method)||![deposits[a.method],'0'].includes(a.deposit))throw Error('Unsupported operation or deposit');
  }
  return {bytes,signer,receiver,publicBytes,nonce,blockHash,actions,role:deploy?'near-contract':'near-operator',hash:base58(sha(bytes)),deploy};
}
