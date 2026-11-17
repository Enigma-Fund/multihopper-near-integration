import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settlementServices} from './settlement-client.mjs';
import {MAINNET_GENESIS} from './receipt.mjs';

test('a lagging RPC retries the same finalized history read without changing its minimum slot',async()=>{
  let reads=0;
  const services=settlementServices({},async(_url,req)=>{
    const {method,params}=JSON.parse(req.body);
    let result;
    if(method==='getGenesisHash')result=MAINNET_GENESIS;
    else if(method==='getSlot')result=1000;
    else if(method==='isBlockhashValid'){assert.equal(params[1].minContextSlot,1000);result={value:false};}
    else if(method==='getFirstAvailableBlock')result=0;
    else if(method==='getSignaturesForAddress'){
      assert.equal(params[1].minContextSlot,1000);assert.equal(params[1].commitment,'finalized');
      if(++reads<3)return Response.json({id:1,error:{code:-32016}});
      result=[];
    }else throw Error('Unexpected '+method);
    return Response.json({id:1,result});
  });
  assert.equal(await services.findExpiredMessage('test-owner',500,'digest','expired-hash'),null);
  assert.equal(reads,3);
});

test('unavailable history stays blocked and errors disclose no endpoint credentials or provider payload',async()=>{
  const secret='https://rpc.invalid/private-key';
  const services=settlementServices({SWARM_ARCHIVE_RPC:secret},async(_url,req)=>{
    const {method}=JSON.parse(req.body);
    return Response.json(method==='getGenesisHash'?{id:1,result:MAINNET_GENESIS}:{id:1,error:{code:-32601,message:secret}});
  });
  await assert.rejects(()=>services.finalizedSlot(),error=>{
    assert.match(error.message,/getSlot.*RPC -32601/);assert.ok(!error.message.includes(secret));return true;
  });
});

test('transport retry never treats a wrong chain as Solana mainnet',async()=>{
  let calls=0;
  const services=settlementServices({},async(_url,req)=>{
    assert.equal(JSON.parse(req.body).method,'getGenesisHash');calls++;
    return Response.json({id:1,result:'different-network'});
  });
  await assert.rejects(()=>services.finalizedSlot(),/wrong network/);assert.equal(calls,2);
});
