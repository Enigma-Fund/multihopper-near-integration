import {createHash,createPublicKey,verify} from 'node:crypto';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeKey(s){if(typeof s!=='string'||s.length<32||s.length>44)throw Error('Invalid public key');let n=0n;for(const c of s){const d=alphabet.indexOf(c);if(d<0)throw Error('Invalid public key');n=n*58n+BigInt(d);}const out=[];while(n){out.unshift(Number(n&255n));n>>=8n;}for(const c of s){if(c!=='1')break;out.unshift(0);}if(out.length!==32)throw Error('Invalid public key');return Buffer.from(out);}
function base64(s){if(typeof s!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw Error('Invalid proof encoding');return Buffer.from(s,'base64');}
// Verifies the MultiHopper screener's MHC:v1:hops signature and exact ordered
// recipient binding. expectedSigner must come from an independently validated
// on-chain ComplianceConfig; this function does not obtain or authenticate it.
// The screener's signature is not itself a TRM-provider attestation.
export function verifyHopsProof({proof,expectedSigner,programId,routeId,creator,baseIndex,recipients,nowSeconds=Math.floor(Date.now()/1000)}){
 if(!proof||proof.ok!==true||proof.signerPubkey!==expectedSigner||!Buffer.isBuffer(routeId)||routeId.length!==32||!Number.isInteger(baseIndex)||baseIndex<0||baseIndex>255||!Array.isArray(recipients)||recipients.length<1||recipients.length>255||!Number.isSafeInteger(nowSeconds))throw Error('Invalid screening proof request');
 const signer=decodeKey(expectedSigner),program=decodeKey(programId),creatorKey=decodeKey(creator),recipientKeys=recipients.map(decodeKey);if(signer.every(x=>x===0))throw Error('Screening signer is not configured');
 const message=base64(proof.message),sig=base64(proof.signature);if(sig.length!==64||message.length!==11+32+32+32+1+32+8)throw Error('Invalid screening proof size');
 const expiry=message.readBigInt64LE(message.length-8);if(expiry<BigInt(nowSeconds))throw Error('Screening proof expired');
 const hash=createHash('sha256').update(Buffer.concat(recipientKeys)).digest();const tail=Buffer.alloc(8);tail.writeBigInt64LE(expiry);const expected=Buffer.concat([Buffer.from('MHC:v1:hops'),program,routeId,creatorKey,Buffer.from([baseIndex]),hash,tail]);
 if(!message.equals(expected))throw Error('Screening proof does not match route');
 const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),signer]),format:'der',type:'spki'});
 if(!verify(null,message,publicKey,sig))throw Error('Invalid screening proof signature');
 return {verified:true,expiry:expiry.toString(),coverage:'creator and ordered recipients'};
}
