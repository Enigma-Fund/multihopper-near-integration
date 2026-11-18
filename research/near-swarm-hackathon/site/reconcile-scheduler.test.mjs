import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './reconcile-scheduler.mjs';
test('scheduled execution calls only the fixed verification endpoint and surfaces failure',async()=>{
 const original=globalThis.fetch;let pending;
 try{
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://multihopper-swarm-for-hire.pages.dev/near-swarm/api/reconcile');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer synthetic-token');return new Response('{}');};
  await worker.scheduled({}, {RECONCILE_TOKEN:'synthetic-token'}, {waitUntil(p){pending=p;}});await pending;
  globalThis.fetch=async()=>new Response('',{status:503});
  await worker.scheduled({}, {RECONCILE_TOKEN:'synthetic-token'}, {waitUntil(p){pending=p;}});await assert.rejects(pending,/503/);
  assert.equal(worker.fetch().status,404);
 }finally{globalThis.fetch=original;}
});
