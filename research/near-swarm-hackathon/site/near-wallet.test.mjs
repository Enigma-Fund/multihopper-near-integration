import {test} from 'node:test';
import assert from 'node:assert/strict';
import {meteorRequest,METEOR_ORIGIN} from './near-wallet.mjs';
function mock(){
 const handlers=new Set(),sent=[],popup={closed:false,location:{href:''},postMessage:(data,origin)=>sent.push({data,origin})};
 const host={location:{href:'https://workspace.example/near-swarm'},addEventListener:(n,f)=>handlers.add(f),removeEventListener:(n,f)=>handlers.delete(f)};
 return {host,popup,sent,handlers,emit:(data,origin=METEOR_ORIGIN,source=popup)=>{for(const h of handlers)h({data,origin,source});}};
}
test('Meteor binds the account request to an unpredictable connection, wallet origin and window',async()=>{
 const m=mock(),inputs={accountId:'alice.near',nonce:new Uint8Array(32),recipient:'workspace.example',message:'signed terms'};
 const request=meteorRequest('sign_message',inputs,m.popup,{host:m.host});
 const {uid}=m.sent[0].data;
 assert.equal(new URL(m.popup.location.href).pathname,'/connect/mainnet/sign_message');assert.equal(new URL(m.popup.location.href).searchParams.get('source'),'wpm');
 assert.equal(m.sent[0].origin,METEOR_ORIGIN);assert.equal(m.sent[0].data.inputs,inputs);
 let complete=false;request.then(()=>complete=true);
 m.emit({uid,status:'closed_success',payload:'forged'},'https://attacker.example');
 m.emit({uid,status:'closed_success',payload:'forged'},METEOR_ORIGIN,{});
 m.emit({uid:'wrong',status:'closed_success',payload:'forged'});
 await Promise.resolve();assert.equal(complete,false);
 m.emit({uid,status:'connected'});m.emit({uid,status:'attempting_reconnect'});
 assert.equal(m.sent.at(-1).data.uid,uid);
 m.emit({uid,status:'closed_success',payload:{signature:'proof'}});
 assert.deepEqual(await request,{signature:'proof'});assert.equal(m.sent.at(-1).data.status,'closed_success');assert.equal(m.handlers.size,0);
});
test('a lost wallet response does not create or retry a different transaction request',async()=>{
 const m=mock();const request=meteorRequest('sign',{transactions:'one unsigned transaction'},m.popup,{host:m.host,timeout:5});
 await assert.rejects(request,/Resume the same job/);
 assert.equal(new Set(m.sent.map(s=>s.data.uid)).size,1);assert.equal(m.handlers.size,0);
 const count=m.sent.length;await new Promise(r=>setTimeout(r,550));assert.equal(m.sent.length,count);
});
test('wallet rejection and blocked popup fail without submitting anything elsewhere',async()=>{
 const m=mock(),request=meteorRequest('sign',{transactions:'one'},m.popup,{host:m.host});
 m.emit({uid:m.sent[0].data.uid,status:'closed_fail'});await assert.rejects(request,/did not complete/);assert.equal(m.handlers.size,0);
 m.popup.closed=true;assert.throws(()=>meteorRequest('sign',{},m.popup,{host:m.host}),/Allow the NEAR/);
});
