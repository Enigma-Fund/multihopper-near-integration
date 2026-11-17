import {hashHex} from './near-job.mjs';
import {fromBase58} from './orders.mjs';

const system='11111111111111111111111111111111';
const orchestration='4TPCmR2uN3hDM1FbTsf7ZtFXwXGSz4u1Kxv5YHj6eruX';
function walletCredit(tx,signature,recipient){
  if(!Number.isSafeInteger(tx?.slot)||tx.meta?.err!==null||tx.transaction?.signatures?.[0]!==signature)throw Error('A successful finalized Solana transaction is required');
  const keys=tx.transaction.message.accountKeys.map(k=>k.pubkey);
  const index=keys.indexOf(recipient);
  if(index<0)throw Error('Receipt does not contain the expected wallet');
  const pre=tx.meta.preBalances[index],post=tx.meta.postBalances[index],fee=index===0?tx.meta.fee:0;
  if(![pre,post,fee].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Cannot establish an exact wallet credit from this receipt');
  return BigInt(post)-BigInt(pre)+BigInt(fee);
}
export async function verifyPayout(rpc,signature,recipient,amount,program=orchestration){
  fromBase58(signature,64);
  const tx=await rpc(signature,'jsonParsed');
  if(walletCredit(tx,signature,recipient)!==BigInt(amount))throw Error('Finalized wallet credit differs from the quoted payout');
  const instructions=tx.transaction.message.instructions;
  const groups=tx.meta.innerInstructions??[];
  let value=0n;
  for(const group of groups){
    if(instructions[group.index]?.programId!==program)continue;
    for(const ix of group.instructions){
      const info=ix.parsed?.info;
      if(ix.programId===system && ix.parsed?.type==='transfer' && info.destination===recipient && info.source!==recipient){
        if(!Number.isSafeInteger(info.lamports)||info.lamports<1)throw Error('Invalid Solana transfer amount');
        value+=BigInt(info.lamports);
      }
    }
  }
  // Committed native payments also move lamports directly in the program.
  // Accept a single attributed source debit with the payee in the ABI destination slot.
  if(value===0n){
    const discriminator=(await hashHex('global:execute_step_transfer_committed')).slice(0,16);
    const transfers=instructions.filter(ix=>{
      if(ix.programId!==program || ix.accounts?.[3]!==recipient)return false;
      try{return Array.from(fromBase58(ix.data,73).subarray(0,8),b=>b.toString(16).padStart(2,'0')).join('')===discriminator;}
      catch{return false;}
    });
    if(transfers.length===1){
      const source=transfers[0].accounts[2],keys=tx.transaction.message.accountKeys;
      const at=keys.findIndex(k=>k.pubkey===source);
      const touched=instructions.filter(ix=>ix.accounts?.includes(source)||ix.accounts?.includes(recipient)||Object.values(ix.parsed?.info??{}).some(v=>v===source||v===recipient));
      const pre=tx.meta.preBalances[at],post=tx.meta.postBalances[at];
      if(at>0 && touched.length===1 && Number.isSafeInteger(pre)&&Number.isSafeInteger(post))value=BigInt(pre)-BigInt(post);
    }
  }
  if(value!==BigInt(amount))throw Error('The route receipt does not prove the quoted SOL transfer');
  return {signature,slot:tx.slot};
}
// Wallets add signatures to the prepared Solana message. Hash the message bytes only.
export async function messageHash(encoded){
  if(typeof encoded!=='string'||encoded.length>1800 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('Invalid serialized Solana transaction');
  const wire=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const count=wire[0],offset=1+64*count;
  if(!count||count>19||offset+4>=wire.length||wire.length>1232)throw Error('Invalid transaction signature count');
  const header=wire[offset];
  if(header&128 && header!==128)throw Error('Unsupported transaction version');
  if(wire[offset+(header===128?1:0)]!==count)throw Error('Transaction signature count does not match its header');
  return hashHex(wire.subarray(offset));
}
export async function verifyRecovery(rpc,signatures,expected,owner,program=orchestration){
  if(!Array.isArray(expected)||!expected.length||signatures.length!==expected.length ||
     new Set(signatures).size!==signatures.length)throw Error('Supply each transaction of the prepared recovery exactly once');
  let received=0n;
  const receipts=[];
  const nativeKinds=await Promise.all(['refund_failed_step','cancel_revolver_step'].map(async name=>(await hashHex('global:'+name)).slice(0,16)));
  for(const [i,signature] of signatures.entries()){
    fromBase58(signature,64);
    const raw=await rpc(signature,'base64');
    if(raw?.meta?.err!==null || raw.transaction?.[1]!=='base64'||await messageHash(raw.transaction[0])!==expected[i])throw Error('Recovery differs from the route-specific prepared transaction');
    const tx=await rpc(signature,'jsonParsed');
    if(tx?.slot!==raw.slot)throw Error('Recovery observations differ');
    const credit=walletCredit(tx,signature,owner);
    if(credit<0n)throw Error('Recovery reduced the owner balance before network fees');
    let nativeRefund=false;
    for(const ix of tx.transaction.message.instructions){
      if(ix.programId!==program || ix.accounts?.[1]!==owner)continue;
      let data;
      try{data=fromBase58(ix.data,41);}catch{continue;}
      const kind=Array.from(data.subarray(0,8),b=>b.toString(16).padStart(2,'0')).join('');
      if(nativeKinds.includes(kind))nativeRefund=true;
    }
    receipts.push({signature,slot:tx.slot,nativeRefund});
    received+=credit;
  }
  if(!receipts.some(x=>x.nativeRefund)||received<=0n)throw Error('The prepared recovery has no verifiable native SOL refund');
  return {receipts,received:received.toString()};
}

export const screeningConfigAddress='CB42Tr91VVUFNYe2R9sjEXtm9RWvSvFEtyHmKP9jqT5c';
export async function screeningSigner(readAccount){
  const config=await readAccount(screeningConfigAddress);
  if(config?.owner!=='3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh'||config.executable!==false||config.data?.[1]!=='base64')throw Error('Unable to authenticate the Solana screening configuration');
  const data=Uint8Array.from(atob(config.data[0]),c=>c.charCodeAt(0));
  if(data.length!==40||Array.from(data.slice(0,8),v=>v.toString(16).padStart(2,'0')).join('')!==(await hashHex('account:ComplianceConfig')).slice(0,16)||!data.slice(8).some(Boolean))throw Error('Route screening is unavailable');
  return data.slice(8);
}
export async function verifyPaymentScreen(tx,owner,recipient,signer,program=orchestration){
  if(!Number.isSafeInteger(tx.blockTime)||tx.blockTime<1)throw Error('Missing screening timestamp');
  const ins=tx.transaction.message.instructions,domain=new TextEncoder().encode('MHC:v1:step');
  const ixDisc=(await hashHex('global:execute_step_transfer_committed')).slice(0,16);
  const key=await crypto.subtle.importKey('raw',signer,'Ed25519',false,['verify']);
  for(const [index,ix] of ins.entries()){
    if(ix.programId!==program||ix.accounts?.[3]!==recipient||ix.accounts?.[5]!==screeningConfigAddress)continue;
    let data;try{data=fromBase58(ix.data,73);}catch{continue;}
    if(Array.from(data.slice(0,8),v=>v.toString(16).padStart(2,'0')).join('')!==ixDisc)continue;
    const prefix=Uint8Array.from([...domain,...fromBase58(program,32),...data.slice(8,41),...fromBase58(owner,32),...fromBase58(recipient,32),...new Uint8Array(32)]);
    for(const evidence of ins.slice(0,index)){
      if(evidence.programId!=='Ed25519SigVerify111111111111111111111111111')continue;
      let bytes;try{bytes=fromBase58(evidence.data,112+prefix.length+8);}catch{continue;}
      const v=new DataView(bytes.buffer,bytes.byteOffset),off=i=>v.getUint16(i,true);
      if(bytes[0]!==1||off(4)!==65535||off(8)!==65535||off(14)!==65535||off(12)!==prefix.length+8)continue;
      const pk=bytes.slice(off(6),off(6)+32),sig=bytes.slice(off(2),off(2)+64),msg=bytes.slice(off(10),off(10)+off(12));
      if(pk.length!==32||!signer.every((b,i)=>b===pk[i])||sig.length!==64||msg.length!==off(12)||!prefix.every((b,i)=>b===msg[i])||new DataView(msg.buffer,msg.byteOffset).getBigInt64(prefix.length,true)<BigInt(tx.blockTime))continue;
      if(await crypto.subtle.verify('Ed25519',key,sig,msg))return {issuer:'MultiHopper screener',coverage:'Payment creator and destination',orchestratorId:Array.from(data.slice(8,40),v=>v.toString(16).padStart(2,'0')).join(''),step:data[40]};
    }
  }
  throw Error('Missing authenticated screening evidence for this owner and payout');
}
