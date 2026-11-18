import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizationCache} from './authorization-cache.mjs';
const scope={owner:'alice',id:'job',action:'wallet-run',mode:'payment',invoice:'one',extra:'100'};
test('reuse exact unexpired scope without signing again; caller mutation cannot broaden cache',async()=>{
 let calls=0;const cache=authorizationCache(()=>1000),sign=async()=>{calls++;return {...scope,expires:100000,signature:'signed'};};
 const first=await cache.get(scope,sign);first.extra='999';
 assert.equal((await cache.get(scope,sign)).extra,'100');assert.equal(calls,1);
 cache.clear();await cache.get(scope,sign);assert.equal(calls,2);
});
test('changed identity, invoice, budget and recovery require new authorization',async()=>{
 for(const delta of [{owner:'bob'},{id:'other'},{invoice:'two'},{extra:'101'},{mode:'recovery'}]){
 let calls=0;const c=authorizationCache(()=>1000);await c.get(scope,async()=>({...scope,expires:100000,signature:'s'}));
 const next={...scope,...delta};await c.get(next,async()=>{calls++;return {...next,expires:100000,signature:'new'};});assert.equal(calls,1);
 }
});
test('expiry never silently extends and non-payment actions are not cached',async()=>{
 let now=0,calls=0;const c=authorizationCache(()=>now),sign=async()=>{calls++;return {...scope,expires:100000,signature:'s'};};
 await c.get(scope,sign);now=80000;await c.get(scope,sign);assert.equal(calls,2);
 now=100001;await assert.rejects(c.get(scope,sign),/does not match/);
 let reads=0;const read=async()=>{reads++;return {};};await c.get({...scope,action:'refresh'},read);await c.get({...scope,action:'refresh'},read);assert.equal(reads,2);
});
