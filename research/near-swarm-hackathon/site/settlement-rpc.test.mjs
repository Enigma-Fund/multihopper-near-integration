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
test('a multi-transaction retry shares a finalized snapshot only within the same request',async()=>{
 let histories=0,heads=0;
 const transport=async(_url,req)=>{const {method}=JSON.parse(req.body);let result;
 if(method==='getGenesisHash')result=MAINNET_GENESIS;
 else if(method==='getSlot'){heads++;result=1000;}
 else if(method==='isBlockhashValid')result={value:false};
 else if(method==='getFirstAvailableBlock')result=0;
 else if(method==='getSignaturesForAddress'){histories++;result=[];}
 else assert.fail(method);
 return Response.json({id:1,result});};
 const first=settlementServices({},transport);
 for(const digest of ['one','two','three'])assert.equal(await first.findExpiredMessage('owner',500,digest,'block'),null);
 assert.equal(histories,1);assert.equal(heads,1);
 await settlementServices({},transport).findExpiredMessage('owner',500,'four','block');assert.equal(histories,2);assert.equal(heads,2);
});
test('readiness probes finalized history through the private server connection, not just account lookup',async()=>{
 const endpoint='https://private-rpc.invalid/server-secret',owner='11111111111111111111111111111111',calls=[];
 const services=settlementServices({SWARM_ARCHIVE_RPC:endpoint,SWARM_PROVIDER_AUTHORITY:owner},async(url,req)=>{
   assert.equal(url,endpoint);const {method,params}=JSON.parse(req.body);calls.push(method);
   const results={getGenesisHash:MAINNET_GENESIS,getSlot:1000,getFirstAvailableBlock:0,getSignaturesForAddress:[]};
   if(method==='getSignaturesForAddress')assert.deepEqual(params,[owner,{limit:1,commitment:'finalized',minContextSlot:1000}]);
   assert.ok(method in results);return Response.json({id:1,result:results[method]});
 });
 assert.equal(await services.historyState(),'available');
 assert.deepEqual(calls,['getGenesisHash','getSlot','getFirstAvailableBlock','getSignaturesForAddress']);
});
test('the hosted app does not advertise payment readiness when history is unavailable',async()=>{
 const {serve}=await import('./worker.mjs?history-readiness');
 const services={configured:true,usage:async()=>true,providerState:async()=>'registered',near:{readiness:async()=>true},historyState:async()=>{throw Error('private connection detail');}};
 const health=await serve(new Request('https://example.com/near-swarm/api/health'),{}, {},undefined,services);
 assert.equal(health.status,503);const state=await health.json();assert.equal(state.history,'unavailable');assert.ok(!JSON.stringify(state).includes('private connection detail'));
 const capabilities=await serve(new Request('https://example.com/near-swarm/api'),{}, {},undefined,services);
 const data=await capabilities.json();assert.equal(data.fundedPayments,false);assert.equal(data.refunds,false);
});
