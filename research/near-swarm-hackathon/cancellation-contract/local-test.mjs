import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Sandbox} from '../../hub/near/sandbox/node.mjs';
const wasm=fileURLToPath(new URL('./target/wasm32-unknown-unknown/release/multihopper_swarm_cancellation.wasm',import.meta.url));
let s;let checks=0;
try{
 s=await Sandbox.create();
 for(const a of ['owner','recipient','other'])await s.account(a+'.synthetic');
 for(const c of ['refund','paid','failed'])await s.account(c+'.synthetic',wasm,{owner:'owner.synthetic',recipient:c==='failed'?'missing.synthetic':'recipient.synthetic'});
 const call=(c,m,deposit='0',actor='owner.synthetic')=>s.rpc.call(actor,c+'.synthetic',m,{},deposit);
 const view=c=>s.rpc.view(c+'.synthetic','status',{});
 const rejects=async f=>{await assert.rejects(f);checks++;};
 for(const c of ['refund','paid','failed'])await call(c,'fund','1000000000000000000000');
 await rejects(()=>call('refund','fund','1000000000000000000000'));
 await rejects(()=>call('refund','cancel','0','other.synthetic'));
 await s.restart();
 await call('refund','cancel');assert.equal((await view('refund')).state,'refunded');checks++;
 await rejects(()=>call('refund','cancel'));await rejects(()=>call('refund','release'));
 assert.equal((await view('paid')).state,'funded');checks++;
 await call('paid','release');assert.equal((await view('paid')).state,'paid');checks++;
 await rejects(()=>call('paid','cancel'));await rejects(()=>call('paid','fund','1'));
 await call('failed','release');assert.equal((await view('failed')).state,'funded');checks++;
 await s.restart();await call('failed','cancel');assert.equal((await view('failed')).state,'refunded');checks++;
 console.log(JSON.stringify({checks,synthetic:true,network:'local',result:'passed'}));
}finally{await s?.cleanup();}
