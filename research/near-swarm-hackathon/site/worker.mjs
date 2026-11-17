import {order} from './orders.mjs';
import {screeningReceipt,lookupReceipt,ReceiptUnavailable,publicReceiptEndpoints} from './receipt.mjs';

const base='/near-swarm';
const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.mainnet.solana.com https://solana-rpc.publicnode.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
const json=(data,status=200)=>Response.json(data,{status,headers:security});
async function input(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw Error('JSON required');
  const reader=request.body?.getReader(); if(!reader)throw Error('Empty request');
  const decoder=new TextDecoder();
  let size=0, text='';
  for (;;) {
    const {value,done}=await reader.read();if(done)break;
    size+=value.length;if(size>4096){await reader.cancel();throw Error('Request too large');}
    text+=decoder.decode(value,{stream:true});
  }
  const data=JSON.parse(text+decoder.decode());
  if(!data || typeof data!=='object' || Array.isArray(data))throw Error('Invalid request');
  return data;
}
export async function serve(request,env,assets,readRpc) {
  const url=new URL(request.url);
  if(url.pathname!==base && !url.pathname.startsWith(base+'/'))return env.ASSETS.fetch(request);
  const path=url.pathname.slice(base.length);
  if(request.method==='GET'||request.method==='HEAD'){
    if(path==='/api'||path==='/api/')return json({name:'MultiHopper Swarm for Hire',version:1,chain:'solana:mainnet',signedJobs:true,fundedPayments:false,refunds:false,
      methods:{'POST /near-swarm/api/orders':'Sign the canonical message for create, read or close with the owner’s Solana wallet. See the public integration for the message format.',
      'POST /near-swarm/api/screening':{signature:'finalized Solana transaction signature',routeId:'32-byte on-chain route ID in hex'}}});
    const asset=assets[path||'/']; if(!asset)return json({error:'Not found'},404);
    return new Response(request.method==='HEAD'?null:asset[1],{headers:{...security,'Content-Type':asset[0]}});
  }
  if(request.method!=='POST'|| !['/api/orders','/api/screening'].includes(path))return json({error:'Not found'},404);
  if(request.headers.has('origin')&&request.headers.get('origin')!==url.origin)return json({error:'Origin mismatch'},403);
  try{
    const data=await input(request);
    if(path==='/api/screening'){
      // Only an operator can configure a private archival provider. Never return its URL to the client.
      const endpoints=env.SWARM_ARCHIVE_RPC?.startsWith('https://') ? [env.SWARM_ARCHIVE_RPC,...publicReceiptEndpoints] : publicReceiptEndpoints;
      return json(readRpc ? await screeningReceipt(readRpc,data.signature,data.routeId) : await lookupReceipt(data.signature,data.routeId,endpoints));
    }
    if(!env.SWARM_JOBS)return json({error:'Job storage unavailable'},503);
    return json({job:await order(env.SWARM_JOBS,url.origin,data)});
  }catch(e){
    if(e instanceof ReceiptUnavailable)return json({error:e.message},503);
    if (/D1_|SQLITE|binding|database/i.test(e.message))return json({error:'Job storage unavailable'},503);
    return json({error:e instanceof SyntaxError?'Invalid JSON':e.message},400);
  }
}
