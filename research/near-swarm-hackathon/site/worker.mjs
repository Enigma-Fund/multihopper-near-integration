import {reconcileTrigger} from './reconcile-trigger.mjs';
import {shareReceipt,publicSharedReceipt,sharedReceiptHtml} from './shared-receipt.mjs';
import {order} from './orders.mjs';
import {screeningReceipt,lookupReceipt,ReceiptUnavailable,publicReceiptEndpoints} from './receipt.mjs';

import {notificationKey,notificationOrigin} from './notifications.mjs';
import {settleOrder,observeSettlement} from './settlement.mjs';
import {settlementServices,ServiceUnavailable} from './settlement-client.mjs';

const base='/near-swarm';
let readinessCache;
async function publicReadiness(services,env){
  if(!services.configured)return {solanaApi:'unconfigured',provider:'unconfigured'};
  if(readinessCache && readinessCache.until>Date.now())return readinessCache.promise;
  let providerDiagnostic,historyDiagnostic;
  const promise=Promise.all([services.usage().then(()=>'authenticated').catch(()=>'unavailable'),
    services.providerState().catch(error=>{if(error instanceof ServiceUnavailable&&/^Solana \w+ is unavailable \([\w ,+-]+\)\. Resume the same invoice\.$/.test(error.message))providerDiagnostic=error.message;return 'unknown';}),
    services.near?services.near.readiness().then(()=>'verified').catch(()=>'unavailable'):Promise.resolve('unconfigured'),
    services.historyState?services.historyState().catch(error=>{if(error instanceof ServiceUnavailable&&/^Solana \w+ is unavailable \([\w ,+-]+\)\. Resume the same invoice\.$/.test(error.message))historyDiagnostic=error.message;return 'unavailable';}):Promise.resolve('unconfigured')
  ]).then(([solanaApi,provider,nearContract,history])=>({solanaApi,provider,nearContract,history,...(providerDiagnostic?{providerDiagnostic}:{}),...(historyDiagnostic?{historyDiagnostic}:{})}));
  readinessCache={until:Date.now()+30000,promise};return promise;
}
const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.mainnet.solana.com https://solana-rpc.publicnode.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
const json=(data,status=200)=>Response.json(data,{status,headers:security});
async function input(request,asText=false) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw Error('JSON required');
  const reader=request.body?.getReader(); if(!reader)throw Error('Empty request');
  const decoder=new TextDecoder();
  let size=0, text='';
  for (;;) {
    const {value,done}=await reader.read();if(done)break;
    size+=value.length;if(size>32768){await reader.cancel();throw Error('Request too large');}
    text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();if(asText)return text;
  const data=JSON.parse(text);
  if(!data || typeof data!=='object' || Array.isArray(data))throw Error('Invalid request');
  return data;
}
export async function serve(request,env,assets,readRpc,services=settlementServices(env)) {
  const url=new URL(request.url);
  if(url.pathname!==base && !url.pathname.startsWith(base+'/'))return env.ASSETS.fetch(request);
  const path=url.pathname.slice(base.length);
  if((request.method==='GET'||request.method==='HEAD')&&path.startsWith('/receipts/')){
    if(!env.SWARM_JOBS)return json({error:'Unavailable'},503);
    const receipt=await publicSharedReceipt(env.SWARM_JOBS,path.slice('/receipts/'.length));
    if(!receipt)return json({error:'Receipt unavailable'},404);
    return new Response(request.method==='HEAD'?null:sharedReceiptHtml(receipt),{headers:{...security,'Content-Type':'text/html; charset=utf-8','X-Robots-Tag':'noindex, nofollow'}});
  }
  if(request.method==='GET'||request.method==='HEAD'){
    if(path==='/api/health'||path==='/api'||path==='/api/'){
      const readiness=await publicReadiness(services,env);
      if(path==='/api/health'){
        const notifications=url.origin===notificationOrigin && readiness.solanaApi==='authenticated' ? await notificationKey(env,services).then(()=>true).catch(()=>false) : false;
        return json({...readiness,notifications},readiness.solanaApi==='authenticated'&&readiness.provider==='registered'&&readiness.nearContract==='verified'&&readiness.history==='available'?200:503);
      }
      const ready=readiness.solanaApi==='authenticated'&&readiness.provider==='registered'&&readiness.nearContract==='verified'&&readiness.history==='available';
      return json({name:'MultiHopper Swarm for Hire',version:4,durableReconciliation:true,receiptVersion:2,documentation:url.origin+base+'/api/docs',workspaceStop:true,healthyRouteCancellation:false,shareableReceipts:true,nearJobLinks:true,productionApiConfigured:services.configured,readiness,invoiceVerification:true,chain:'solana:mainnet',signedJobs:true,nearContract:services.near?.contract??null,fundedPayments:ready,refunds:ready,
      methods:{'POST /near-swarm/api/settlement':'Dual-signed NEAR job linkage, signed invoice quotes, payout and recovery reconciliation. Refer to the integration source for the signed fields.', 'POST /near-swarm/api/orders':'Sign the canonical message for create, read or close with the owner’s Solana wallet. See the public integration for the message format.',
      'POST /near-swarm/api/screening':{signature:'finalized Solana transaction signature',routeId:'32-byte on-chain route ID in hex'}}});
    }
    const asset=assets[path||'/']; if(!asset)return json({error:'Not found'},404);
    return new Response(request.method==='HEAD'?null:asset[1],{headers:{...security,'Content-Type':asset[0]}});
  }
  if(request.method==='POST'&&path==='/api/reconcile'){
    try {const r=await reconcileTrigger(request,env.SWARM_JOBS,services);return json(r.body,r.status);}catch{return json({error:'Reconciliation unavailable'},503);}
  }
  if(request.method==='POST'&&path==='/api/notifications'){
    if(!env.SWARM_JOBS)return json({error:'Service unavailable'},503);
    const sig=request.headers.get('x-mh-signature');
    if(!sig||!/^[0-9a-f]{64}$/.test(sig))return json({error:'Invalid event signature'},401);
    try{const raw=await input(request,true);
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(await notificationKey(env,services)),{name:'HMAC',hash:'SHA-256'},false,['verify']);
      if(!await crypto.subtle.verify('HMAC',key,Uint8Array.from(sig.match(/../g),p=>parseInt(p,16)),new TextEncoder().encode(raw)))return json({error:'Invalid event signature'},401);
      const result=await observeSettlement(env.SWARM_JOBS,services,JSON.parse(raw));
      if(result&&!['payout-confirmed','recovery-credit-confirmed'].includes(result.status))return json({status:'awaiting evidence'},503);
      return json({received:true});
    }catch{return json({error:'Settlement reconciliation pending'},503);}
  }
  if(request.method!=='POST'|| !['/api/orders','/api/screening','/api/settlement','/api/receipt-share'].includes(path))return json({error:'Not found'},404);
  if(request.headers.has('origin')&&request.headers.get('origin')!==url.origin)return json({error:'Origin mismatch'},403);
  try{
    const data=await input(request);
    if(path==='/api/screening'){
      // Only an operator can configure a private archival provider. Never return its URL to the client.
      const endpoints=env.SWARM_ARCHIVE_RPC?.startsWith('https://') ? [env.SWARM_ARCHIVE_RPC,...publicReceiptEndpoints] : publicReceiptEndpoints;
      return json(readRpc ? await screeningReceipt(readRpc,data.signature,data.routeId) : await lookupReceipt(data.signature,data.routeId,endpoints));
    }
    if(!env.SWARM_JOBS)return json({error:'Job storage unavailable'},503);
    if(path==='/api/receipt-share')return json(await shareReceipt(env.SWARM_JOBS,url.origin,data,services));
    if(path==='/api/settlement')return json(await settleOrder(env.SWARM_JOBS,url.origin,data,services));
    const job=await order(env.SWARM_JOBS,url.origin,data);
    if(data.action==='read'){
      job.near=await env.SWARM_JOBS.prepare('SELECT near_owner AS account,near_job AS jobId,job_key AS jobKey FROM swarm_near_links WHERE owner=? AND id=?').bind(data.owner,data.id).first();
      const history=await env.SWARM_JOBS.prepare('SELECT invoice,transfer_id AS transferId,outcome,received AS creditedLamports,evidence FROM swarm_invoices WHERE owner=? AND id=? ORDER BY rowid DESC LIMIT 100').bind(data.owner,data.id).all();
      job.recentInvoices=history.results.map(({evidence,...invoice})=>({...invoice,receipts:evidence?JSON.parse(evidence):[]}));
    }
    return json({job});
  }catch(e){
    if(e instanceof ReceiptUnavailable || e instanceof ServiceUnavailable)return json({error:e.message},503);
    if (/D1_|SQLITE|binding|database/i.test(e.message))return json({error:'Job storage unavailable'},503);
    return json({error:e instanceof SyntaxError?'Invalid JSON':e.message},400);
  }
}
