import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
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
