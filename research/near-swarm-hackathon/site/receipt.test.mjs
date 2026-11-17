import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MAINNET_GENESIS,ROUTER_PROGRAM,ReceiptUnavailable,lookupReceipt} from './receipt.mjs';

const signature='1'.repeat(64);
const route='00'.repeat(32);
const bytes=Buffer.concat([Buffer.from([112,252,200,234,89,169,208,236]),Buffer.alloc(32)]);
let value=BigInt('0x'+bytes.toString('hex')),data='';
while(value){data='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Number(value%58n)]+data;value/=58n;}
const tx={slot:101,meta:{err:null},transaction:{signatures:[signature],message:{
  accountKeys:[ROUTER_PROGRAM],instructions:[{programIdIndex:0,accounts:[1,2,3,4,5,6],data}]
}}};
function provider(results){
  const calls=[];
  const fetch=async(name,request)=>{
    const {method,params}=JSON.parse(request.body);
    calls.push([name,method]);
    if(method==='getTransaction'){
      assert.equal(params[0],signature);
      assert.equal(params[1].commitment,'finalized');
    }
    const result=method==='getGenesisHash' ? MAINNET_GENESIS : results[name];
    return Response.json({id:1,jsonrpc:'2.0',result});
  };
  return {calls,fetch};
}
test('a missing archive retries and can verify the same route at a second provider',async()=>{
  const p=provider({first:null,second:tx});
  const receipt=await lookupReceipt(signature,route,['first','second'],p.fetch);
  assert.equal(receipt.slot,101);
  assert.equal(receipt.issuer,'MultiHopper screener');
  assert.equal(p.calls.length,4);
});
test('unavailable history has an indeterminate screening result',async()=>{
  const p=provider({first:null,second:null});
  await assert.rejects(lookupReceipt(signature,route,['first','second'],p.fetch),ReceiptUnavailable);
});
test('a failed transaction or different route cannot be turned into a pass by a fallback',async()=>{
  for(const [candidate,id,reason] of [[{...tx,meta:{err:{InstructionError:[0,'InvalidArgument']}}},route,/failed on Solana/],[tx,'fe'.repeat(32),/no matching/]]){
    const p=provider({first:candidate,second:tx});
    await assert.rejects(lookupReceipt(signature,id,['first','second'],p.fetch),reason);
    assert.equal(p.calls.length,2);
  }
});
