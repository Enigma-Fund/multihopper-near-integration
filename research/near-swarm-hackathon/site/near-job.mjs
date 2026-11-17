import {fromBase58} from './orders.mjs';

const utf8=new TextEncoder();
export async function hashHex(data){
  const digest=await crypto.subtle.digest('SHA-256',typeof data==='string'?utf8.encode(data):data);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export function nearMessage(origin,body,job){
  return JSON.stringify(['multihopper-swarm-link-v1',origin,body.nearOwner,body.nearJobId,body.owner,body.id,job.recipient,job.budget,job.cap,body.expires]);
}
function u32(n){const bytes=new Uint8Array(4);new DataView(bytes.buffer).setUint32(0,n,true);return bytes;}
function stringParts(s){const bytes=utf8.encode(s);return [u32(bytes.length),bytes];}
export async function nearDigest(message,nonce,recipient,callbackUrl){
  const parts=[u32(2**31+413),...stringParts(message),nonce,...stringParts(recipient),Uint8Array.of(callbackUrl?1:0)];
  if(callbackUrl)parts.push(...stringParts(callbackUrl));
  const bytes=new Uint8Array(parts.reduce((length,p)=>length+p.length,0));
  let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
  return crypto.subtle.digest('SHA-256',bytes);
}
export async function verifyNearSignature(origin,body,job){
  const proof=body.nearProof;
  if(!proof || proof.accountId!==body.nearOwner || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(proof.publicKey) ||
     !/^[0-9a-f]{64}$/.test(proof.nonce) || typeof proof.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(proof.signature))throw Error('Invalid NEAR wallet proof');
  if(proof.callbackUrl && proof.callbackUrl!==origin+'/near-swarm')throw Error('Unexpected NEAR callback');
  const nonce=Uint8Array.from(proof.nonce.match(/../g),x=>parseInt(x,16));
  const digest=await nearDigest(nearMessage(origin,body,job),nonce,new URL(origin).host,proof.callbackUrl);
  const key=await crypto.subtle.importKey('raw',fromBase58(proof.publicKey.slice(8),32),'Ed25519',false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',key,Uint8Array.from(atob(proof.signature),x=>x.charCodeAt(0)),digest))throw Error('NEAR signature does not bind these work-order terms');
}
export async function verifyNearJob(origin,body,job,accessKey){
  await verifyNearSignature(origin,body,job);
  const access=await accessKey(body.nearOwner,body.nearProof.publicKey);
  if(access?.permission!=='FullAccess' || typeof access.block_hash!=='string')throw Error('A finalized full-access NEAR signing key is required');
  fromBase58(access.block_hash,32);
  return {block:access.block_hash,key:await hashHex(JSON.stringify(['swarm-job-v1',body.nearOwner,body.nearJobId]))};
}
