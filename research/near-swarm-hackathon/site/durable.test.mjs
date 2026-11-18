import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {reconcilePending} from './durable.mjs';
function fixture(){
 const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE swarm_invoices(external_id TEXT,transfer_id TEXT,outcome TEXT); CREATE TABLE swarm_reconcile(reference TEXT PRIMARY KEY,due INTEGER,attempts INTEGER,lease TEXT,until INTEGER,status TEXT);');
 const db={prepare(q){return {bind(...a){const s=raw.prepare(q);return {first:async()=>s.get(...a),all:async()=>({results:s.all(...a)}),run:async()=>({meta:s.run(...a)})};}};}};
 raw.prepare('INSERT INTO swarm_invoices VALUES(?,?,NULL)').run('a','1');return {db,raw};
}
test('concurrent observers claim once; interruption retries without funding capability',async()=>{
 const {db,raw}=fixture();let calls=0,release;const gate=new Promise(r=>release=r);
 const observe=async()=>{calls++;await gate;throw Error('RPC lost');};
 const a=reconcilePending(db,{}, {now:100,observe});await new Promise(r=>setImmediate(r));
 assert.deepEqual(await reconcilePending(db,{}, {now:100,observe}),[]);release();await a;assert.equal(calls,1);
 await reconcilePending(db,{}, {now:30100,observe:async()=>{calls++;raw.exec("UPDATE swarm_invoices SET outcome='payout-confirmed'");return {status:'payout-confirmed'};}});
 assert.equal(calls,2);assert.deepEqual(await reconcilePending(db,{}, {now:999999,observe}),[]);
});
test('expired lease recovers; pending first row does not starve later invoice',async()=>{
 const {db,raw}=fixture();raw.exec("INSERT INTO swarm_reconcile VALUES('a',0,1,'dead',500,NULL); INSERT INTO swarm_invoices VALUES('b','2',NULL)");
 const seen=[];const observe=async(_d,_s,e)=>{seen.push(e.externalId);return {status:'pending'};};
 await reconcilePending(db,{}, {now:100,limit:1,observe});assert.deepEqual(seen,['b']);
 await reconcilePending(db,{}, {now:501,limit:1,observe});assert.deepEqual(seen,['b','a']);
});
test('stale completion cannot overwrite a replacement lease',async()=>{
 const {db,raw}=fixture();let release;const gate=new Promise(r=>release=r);
 const first=reconcilePending(db,{}, {now:0,observe:async()=>{await gate;throw Error('late failure');}});
 await new Promise(r=>setImmediate(r));
 await reconcilePending(db,{}, {now:60001,observe:async()=>({status:'payout-confirmed'})});
 release();await first;
 const state=raw.prepare('SELECT status,due FROM swarm_reconcile').get();
 assert.equal(state.status,'confirmed');assert.equal(state.due,90001);
});
