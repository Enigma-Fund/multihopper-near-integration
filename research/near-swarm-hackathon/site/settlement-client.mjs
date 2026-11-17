import {nearContractServices} from './near-contract.mjs';
import {fromBase58} from './orders.mjs';
import {messageHash} from './settlement-evidence.mjs';
import {hashHex} from './near-job.mjs';
import {MAINNET_GENESIS,ROUTER_PROGRAM} from './receipt.mjs';
export class ServiceUnavailable extends Error {}
class ChainReadUnavailable extends ServiceUnavailable {
  constructor(code,retryable=false){super('The chain provider could not return finalized evidence.');this.code=code;this.retryable=retryable;}
}
const apiRoot='https://multihopper.com/api/v1';
export function settlementServices(env,transport=fetch){
  const key=env.SWARM_SOLANA_API_KEY;
  const configured=typeof key==='string' && key.startsWith('mh_live_');
  async function request(path,{body,idempotency}={}){
    if(!configured)throw new ServiceUnavailable('The workspace has no production Solana API credential configured.');
    const headers={accept:'application/json','x-api-key':key};
    if(body){headers['content-type']='application/json';headers['idempotency-key']=idempotency;}
    let response;
    try{response=await transport(apiRoot+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(9000)});}
    catch{throw new ServiceUnavailable('The Solana API could not be reached. Retry with the same invoice.');}
    if(!response.ok){
      const error=await response.json().catch(()=>({}));
      const code=error?.error?.code??error?.code;
      if(response.status===404 && code==='MH_030')return null;
      if(code==='MH_091')throw new ServiceUnavailable('MultiHopper requires an active on-chain provider and a rent-funded rewards wallet before payment preparation (MH_091).');
      throw new ServiceUnavailable('The Solana API did not accept the request'+(typeof code==='string'&&/^MH_\d{3}$/.test(code)?' ('+code+')':'')+'.');
    }
    return response.json();
  }
  async function rpc(endpoint,method,params){
    try{
      const res=await transport(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'manual',signal:AbortSignal.timeout(6500)});
      if(!res.ok)throw new ChainReadUnavailable('HTTP '+res.status,res.status===429||res.status>=500);
      const data=await res.json();
      if(data.error){
        const code=Number.isSafeInteger(data.error.code)?data.error.code:null;
        throw new ChainReadUnavailable(code===null?'invalid RPC response':'RPC '+code,[-32004,-32005,-32007,-32016].includes(code));
      }
      if(data.id!==1||data.result==null)throw new ChainReadUnavailable('missing RPC result');
      return data.result;
    }catch(error){if(error instanceof ChainReadUnavailable)throw error;throw new ChainReadUnavailable('connection failed',true);}
  }
  const endpoints=[...new Set([env.SWARM_ARCHIVE_RPC,'https://api.mainnet.solana.com','https://solana-rpc.publicnode.com'].filter(Boolean))];
  const checked=new Set();
  async function sol(method,params){
    let failures=[];
    for(let attempt=0;attempt<2;attempt++){
      let retryable=false;failures=[];
      for(const endpoint of endpoints){
        try{
          if(!checked.has(endpoint)){if(await rpc(endpoint,'getGenesisHash',[])!==MAINNET_GENESIS){failures.push('wrong network');continue;}checked.add(endpoint);}
          return await rpc(endpoint,method,params);
        }catch(e){if(!(e instanceof ChainReadUnavailable))throw e;failures.push(e.code);retryable ||= e.retryable;}
      }
      // Retry only reads. Never renew a payment or relax finalized-history checks
      // because a provider is throttled or has not reached minContextSlot yet.
      if(method==='sendTransaction'||!retryable||attempt===1)break;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw new ServiceUnavailable('Solana '+method+' is unavailable ('+[...new Set(failures)].join(', ')+'). Resume the same invoice.');
  }
  return {configured, expectedTest:false, near:nearContractServices(env,rpc),
    registerNotifications:body=>request('/webhooks',{body,idempotency:'swarm-finality-notifications-v1'}),
    async usage(){
      const result=await request('/usage');
      if(result?.isTestMode!==false)throw new ServiceUnavailable('Mainnet API authentication could not be verified.');
      return true;
    },
    async providerState(){
      const authority=env.SWARM_PROVIDER_AUTHORITY;
      if(!authority)return 'unconfigured';
      const pub=fromBase58(authority,32);
      // The registration service returns the provider account address. An exact lookup also
      // works on RPCs that disable program-wide scans. Never infer registration from funding.
      let records;
      async function readProvider(address){
        fromBase58(address,32);
        const {value}=await sol('getAccountInfo',[address,{encoding:'base64',commitment:'finalized'}]);
        return value?[{account:value}]:[];
      }
      if(env.SWARM_PROVIDER_PDA){
        records=await readProvider(env.SWARM_PROVIDER_PDA);
      }else{
        try{
          records=await sol('getProgramAccounts',[ROUTER_PROGRAM,{encoding:'base64',commitment:'finalized',filters:[{dataSize:96},{memcmp:{offset:56,bytes:authority}}]}]);
        }catch(error){
          if(!(error instanceof ServiceUnavailable))throw error;
          const history=await sol('getSignaturesForAddress',[authority,{limit:8,commitment:'finalized'}]);
          if(!Array.isArray(history))throw error;
          const register=(await hashHex('global:register_provider')).slice(0,16);
          records=[];
          for(const entry of history.filter(item=>item.err===null)){
            const tx=await sol('getTransaction',[entry.signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
            for(const ix of tx.transaction.message.instructions){
              if(ix.programId!==ROUTER_PROGRAM||ix.accounts?.[0]!==authority)continue;
              let data;try{data=fromBase58(ix.data,56);}catch{continue;}
              if(Array.from(data.slice(0,8),v=>v.toString(16).padStart(2,'0')).join('')!==register)continue;
              records.push(...await readProvider(ix.accounts[1]));
            }
          }
          if(!records.length)return history.length===8?'unknown':'no-registration-observed';
        }
      }
      const expected=(await hashHex('account:ProviderConfig')).slice(0,16);
      for(const {account} of records){
        if(account.owner!==ROUTER_PROGRAM||account.executable!==false||account.data?.[1]!=='base64')continue;
        const bytes=Uint8Array.from(atob(account.data[0]),c=>c.charCodeAt(0));
        if(bytes.length!==96||Array.from(bytes.slice(0,8),v=>v.toString(16).padStart(2,'0')).join('')!==expected||!pub.every((v,i)=>v===bytes[56+i]))continue;
        return 'registered';
      }
      return 'pending';
    },
    account:async pub=>(await sol('getAccountInfo',[pub,{encoding:'base64',commitment:'finalized'}])).value,
    preparePayment:(id,key)=>request('/transfers/'+id+'/prepare',{body:{},idempotency:key}),
    confirmPayment:(id,body,key)=>request('/transfers/'+id+'/confirm-broadcast',{body,idempotency:key}),
    confirmRefund:(id,body,key)=>request('/transfers/'+id+'/rescue/confirm',{body,idempotency:key}),
    finalizedSlot:()=>sol('getSlot',[{commitment:'finalized'}]),
    latestBlock:async()=>(await sol('getLatestBlockhash',[{commitment:'confirmed'}])).value,
    blockAvailable:async block=>(await sol('isBlockhashValid',[block,{commitment:'confirmed'}])).value,
    async findExpiredMessage(owner,born,digest,blockhash){
      // A confirmed fork or a pruned history cannot rule out a duplicate.
      const head=await sol('getSlot',[{commitment:'finalized'}]);
      if(!Number.isSafeInteger(born)||head-born<400||(await sol('isBlockhashValid',[blockhash,{commitment:'finalized',minContextSlot:head}])).value!==false||await sol('getFirstAvailableBlock',[])>born)throw new ServiceUnavailable('Waiting for complete finalized history before renewing this transaction.');
      let before;
      for(let page=0;page<6;page++){
        const list=await sol('getSignaturesForAddress',[owner,{limit:100,commitment:'finalized',minContextSlot:head,...(before?{before}:{})}]);
        if(!Array.isArray(list))throw new ServiceUnavailable('Wallet history unavailable');
        for(const entry of list){
          if(entry.slot<born)return null;
          if(entry.err)continue;
          const receipt=await sol('getTransaction',[entry.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
          if(receipt?.transaction?.[1]!=='base64')throw new ServiceUnavailable('Wallet history is incomplete');
          if(await messageHash(receipt.transaction[0])===digest)return {signature:entry.signature,slot:entry.slot};
        }
        if(list.length<100)return null;
        before=list.at(-1).signature;
      }
      throw new ServiceUnavailable('Wallet activity exceeds the automatic reconciliation window');
    },
    signatureState:async sig=>(await sol('getSignatureStatuses',[[sig],{searchTransactionHistory:true}])).value[0],
    broadcast:bytes=>sol('sendTransaction',[bytes,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:1}]),
    async simulatedDebit(bytes,owner){
      for(let attempt=0;attempt<4;attempt++){
        const sim=await sol('simulateTransaction',[bytes,{encoding:'base64',commitment:'confirmed',sigVerify:true,accounts:{encoding:'base64',addresses:[owner]}}]);
        if(sim.value?.err)throw Error('Wallet transaction simulation failed');
        const before=await sol('getBalance',[owner,{commitment:'confirmed',minContextSlot:sim.context.slot}]);
        if(before.context.slot!==sim.context.slot)continue;
        const after=sim.value.accounts?.[0]?.lamports;
        if(![before.value,after].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Cannot establish an exact simulated wallet debit');
        return String(Math.max(before.value-after,0));
      }
      throw new ServiceUnavailable('The balance changed slots during simulation. Resume the same invoice.');
    },
    async accessKey(account_id,public_key){
      const endpoint='https://rpc.mainnet.near.org';
      if((await rpc(endpoint,'status',[])).chain_id!=='mainnet')throw new ServiceUnavailable('Unexpected NEAR network');
      return rpc(endpoint,'query',{request_type:'view_access_key',finality:'final',account_id,public_key});
    },
    find:external=>request('/transfers/by-external/'+external),
    create:(body,key)=>request('/transfers',{body,idempotency:key}),
    status:id=>request('/transfers/'+id),
    prepareRefund:(id,key)=>request('/transfers/'+id+'/rescue/prepare',{body:{},idempotency:key}),
    transaction:async(signature,encoding)=>{
      return sol('getTransaction',[signature,{encoding,commitment:'finalized',maxSupportedTransactionVersion:0}]);
    }
  };
}
