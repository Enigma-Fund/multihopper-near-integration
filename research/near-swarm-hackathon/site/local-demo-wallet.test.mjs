import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRequest,LOCAL_DEMO_ORIGIN} from './local-demo-wallet.mjs';
function fixture(){let receive;const sent=[];const popup={closed:false,location:{href:''},postMessage:(data,origin)=>sent.push({data,origin})};
  const host={open:()=>popup,addEventListener:(_,fn)=>receive=fn,removeEventListener:()=>receive=undefined};
  return {popup,host,sent,receive:event=>receive?.(event)};}
test('local wallet accepts only the matching popup, origin and request ID',async()=>{
  const f=fixture(),p=localRequest('connect',{},f.popup,{host:f.host,timeout:2000});
  const uid=new URL(f.popup.location.href).searchParams.get('uid');let completed=false;p.then(()=>completed=true);
  f.receive({source:f.popup,origin:'https://unrelated.example',data:{uid,result:{bad:true}}});
  f.receive({source:{},origin:LOCAL_DEMO_ORIGIN,data:{uid,result:{bad:true}}});
  f.receive({source:f.popup,origin:LOCAL_DEMO_ORIGIN,data:{uid:'old',result:{bad:true}}});
  await Promise.resolve();assert.equal(completed,false);
  f.receive({source:f.popup,origin:LOCAL_DEMO_ORIGIN,data:{uid,result:{publicKey:'public-only'}}});
  assert.deepEqual(await p,{publicKey:'public-only'});
});
test('lost local popup response never creates a replacement signing request',async()=>{
  const f=fixture();let opens=0;f.host.open=()=>{opens++;return f.popup;};
  const p=localRequest('near-sign',{transactions:'synthetic'},undefined,{host:f.host,timeout:1000});
  f.popup.closed=true;await assert.rejects(()=>p,/Resume the same invoice/);assert.equal(opens,1);assert.equal(f.sent.length,0);
});
