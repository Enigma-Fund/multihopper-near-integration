import {createHash} from 'node:crypto';
import {decodeKey} from './screening-proof.mjs';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){let n=BigInt('0x'+bytes.toString('hex')),out='';while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}for(const b of bytes){if(b)break;out='1'+out;}return out;}
const discriminator=createHash('sha256').update('account:ComplianceConfig').digest().subarray(0,8);
// expectedConfigAddress and expectedProgram must be independently pinned from the
// deployed program/PDA. Caller-provided addresses cannot establish provenance.
export async function readComplianceSigner({rpc,expectedGenesis,expectedProgram,expectedConfigAddress}){
 if(!rpc||typeof rpc.request!=='function'||typeof expectedGenesis!=='string'||!expectedGenesis)throw Error('Trusted chain configuration required');
 decodeKey(expectedProgram);decodeKey(expectedConfigAddress);
 const genesis=await rpc.request('getGenesisHash',[]);if(genesis!==expectedGenesis)throw Error('Wrong Solana network');
 const result=await rpc.request('getAccountInfo',[expectedConfigAddress,{encoding:'base64',commitment:'finalized'}]);
 const account=result?.value;if(!Number.isSafeInteger(result?.context?.slot)||!account||account.owner!==expectedProgram||account.executable!==false||!Array.isArray(account.data)||account.data[1]!=='base64'||typeof account.data[0]!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(account.data[0]))throw Error('Invalid compliance configuration account');
 const data=Buffer.from(account.data[0],'base64');if(data.length!==40||!data.subarray(0,8).equals(discriminator))throw Error('Invalid compliance configuration data');
 const signer=data.subarray(8);if(signer.every(v=>v===0))throw Error('Compliance screening is disabled');
 return {signer:base58(signer),slot:result.context.slot,program:expectedProgram,config:expectedConfigAddress};
}
