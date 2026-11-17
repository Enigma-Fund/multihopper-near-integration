import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {base58} from '../../hub/near/sandbox/rpc.mjs';
import {MAINNET_GENESIS,ROUTER_PROGRAM} from './receipt.mjs';
import {store} from '../test-fixtures/settlement-db.mjs';
import {notificationKey,notificationOrigin} from './notifications.mjs';
import {serve} from './worker.mjs';
import {settlementServices} from './settlement-client.mjs';
test('callback is registered once at the fixed address, kept encrypted and authenticated before any lookup',async()=>{
 const env={SWARM_JOBS:store(),SWARM_SOLANA_API_KEY:'mh_live_disposable-test'},secret='ab'.repeat(32);let calls=0;
 const services={async registerNotifications(b){calls++;assert.equal(b.url,notificationOrigin+'/near-swarm/api/notifications');return {...b,isActive:true,secret};}};
 assert.equal(await notificationKey(env,services,true),secret);assert.equal(await notificationKey(env,services,true),secret);assert.equal(calls,1);
 const row=await env.SWARM_JOBS.prepare('SELECT * FROM swarm_notification_key').bind().first();assert.ok(!JSON.stringify(row).includes(secret));
 const payload='{"transferId":1,"externalId":"unrelated"}';
 const deliver=async(sig,body)=>serve(new Request(notificationOrigin+'/near-swarm/api/notifications',{method:'POST',headers:{'content-type':'application/json','x-mh-signature':sig},body}),env,{},undefined,services);
 const sig=createHmac('sha256',secret).update(payload).digest('hex');assert.equal((await deliver(sig,payload)).status,200);assert.equal((await deliver(sig,payload+' ')).status,401);assert.equal((await deliver('0'.repeat(64),payload)).status,401);
});
test('Cloudflare outbound calls use manual redirects and reject redirects and test credentials',async()=>{
 const env={SWARM_SOLANA_API_KEY:'mh_live_disposable'};let called=0;
 const transport=async(url,req)=>{called++;assert.equal(url,'https://multihopper.com/api/v1/usage');assert.equal(req.redirect,'manual');return new Response('',{status:302,headers:{location:'https://other.invalid'}});};
 await assert.rejects(()=>settlementServices(env,transport).usage());assert.equal(called,1);
 await assert.rejects(()=>settlementServices(env,async()=>Response.json({isTestMode:true})).usage());
 assert.equal(await settlementServices(env,async()=>Response.json({isTestMode:false})).usage(),true);
});

test('provider readiness survives disabled program scans and validates the registered account',async()=>{
  const authorityBytes=Buffer.alloc(32,5),authority=base58(authorityBytes),address=base58(Buffer.alloc(32,2));
  const disc=text=>createHash('sha256').update(text).digest().subarray(0,8);
  const data=Buffer.alloc(96);disc('account:ProviderConfig').copy(data,0);authorityBytes.copy(data,56);
  const account={owner:ROUTER_PROGRAM,executable:false,data:[data.toString('base64'),'base64']};
  const register=base58(Buffer.concat([disc('global:register_provider'),Buffer.alloc(48)]));
  const responses={getGenesisHash:MAINNET_GENESIS,getSignaturesForAddress:[],
    getTransaction:{transaction:{message:{instructions:[{programId:ROUTER_PROGRAM,accounts:[authority,address],data:register}]}}},
    getAccountInfo:{value:account}};
  const calls=[];
  const read=async(url,req)=>{
    const {method,params}=JSON.parse(req.body);calls.push(method);
    if(method==='getAccountInfo')assert.equal(params[0],address);
    if(method==='getProgramAccounts')return Response.json({id:1,error:{code:-32010}});
    return Response.json({id:1,result:responses[method]});
  };
  const env={SWARM_PROVIDER_AUTHORITY:authority};
  const inspect=()=>settlementServices(env,read).providerState();
  assert.equal(await inspect(),'no-registration-observed');
  responses.getSignaturesForAddress=[{err:null,signature:base58(Buffer.alloc(64,1))}];
  assert.equal(await inspect(),'registered');
  calls.length=0;env.SWARM_PROVIDER_PDA=address;
  assert.equal(await inspect(),'registered');
  assert.deepEqual(calls,['getGenesisHash','getAccountInfo']);
  account.owner=authority;assert.equal(await inspect(),'pending');
  account.owner=ROUTER_PROGRAM;data[56]^=1;account.data[0]=data.toString('base64');
  assert.equal(await inspect(),'pending');
});
