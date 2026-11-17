import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Sandbox,ROOT} from './node.mjs';
import {LocalNear} from './rpc.mjs';
import {Coordinator,Interrupted} from './coordinator.mjs';
let sandbox,c;let sequence=0;const results=[];const start=Date.now();const out=resolve(ROOT,process.argv.includes('--chambers-regression')?'../../results/near-chambers-20261105/legacy-sandbox':process.argv.includes('--swarm-regression')?'../../results/near-swarm-20261104/legacy-sandbox':process.argv.includes('--ordinary-regression')?'../../results/near-ordinary-grant-20261104/legacy-sandbox':'../../results/near-sandbox-20261104');mkdirSync(out,{recursive:true});
const unit=n=>String(n);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function test(name,fn){const began=Date.now();try{await fn();results.push({name,passed:true,ms:Date.now()-began});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:e.message,ms:Date.now()-began});throw e;}}
const balance=(account,asset='SYNTH-USD')=>sandbox.rpc.view(asset==='SYNTH-USD'?'usd.synthetic':'native.synthetic','balance',{account}).then(BigInt);
const mint=(account,amount,asset='SYNTH-USD')=>sandbox.rpc.call('synthetic',asset==='SYNTH-USD'?'usd.synthetic':'native.synthetic','mint',{account,amount:String(amount)});
async function position(options={}){const now=Math.floor(Date.parse((await sandbox.rpc.verify()).sync_info.latest_block_time)/1000);const p=await c.create({id:'p'+(++sequence),expires:now+3600,...options},a=>sandbox.account(a));await mint(p.owner,p.funded,p.asset);await c.fund(p.key);return p;}
function reopen(crash=null){const directory=c.directory;c.close();c=new Coordinator(directory,sandbox.rpc,crash);}
async function hardCrash(stage,action,args){const config=join(sandbox.directory,'worker.json');writeFileSync(config,JSON.stringify({port:sandbox.port,chainId:sandbox.chainId,journal:c.directory}));
 const child=spawn(process.execPath,[join(ROOT,'worker.mjs'),config,stage,action,...args],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);const code=await new Promise((r,j)=>{child.on('exit',r);child.on('error',j);});assert.equal(code,73,stderr);
}
try{
 sandbox=await Sandbox.create();await sandbox.bootstrap();c=new Coordinator(join(sandbox.directory,'coordinator'),sandbox.rpc);
 await test('real local NEAR node executes compiled WASM with final receipts',async()=>{
  const s=await sandbox.rpc.verify();assert.equal(s.version.version,'2.14.0');assert.equal(s.chain_id,sandbox.chainId);
  for(const account_id of ['treasury.synthetic','usd.synthetic','native.synthetic']){const a=await sandbox.rpc.rpc('query',{request_type:'view_account',account_id,finality:'final'});assert.notEqual(a.code_hash,'11111111111111111111111111111111');}
 });
 await test('fund 100, deliver 60, recover exactly 40',async()=>{
  const p=await position();const before=await balance('merchant'),owner=await balance(p.owner);const a=await c.authorize(p.key,'pay'+sequence,'60');await c.dispatch(a.key);await c.recover(p.key);assert.equal(await balance('merchant')-before,60n);assert.equal(await balance(p.owner)-owner,40n);assert.equal(await balance(p.address),0n);assert.equal((await c.policy(p.key)).spent,'60');
 });
 await test('same asset across users remains in distinct custody accounts',async()=>{
  const a=await position(),b=await position({owner:'bob.synthetic'});assert.notEqual(a.address,b.address);await c.recover(a.key);assert.equal(await balance(b.address),100n);
  await assert.rejects(()=>sandbox.rpc.call('intruder.synthetic','usd.synthetic','fenced_transfer',{id:'steal',binding:'a'.repeat(64),recipient:'merchant',amount:'100',cancel:false},'1'),/insufficient/);assert.equal(await balance(b.address),100n);
 });
 await test('chain and asset domains get distinct accounts',async()=>{
  const a=await position(),b=await position({chain:'solana'}),d=await position({asset:'SYNTH-NATIVE'});assert.equal(new Set([a.address,b.address,d.address]).size,3);assert.equal(await balance(d.address,'SYNTH-NATIVE'),100n);assert.equal(await balance(d.address),0n);
 });
 await test('on-chain per-payment and pending budget limits cannot be bypassed',async()=>{
  const p=await position({funded:'200'});await assert.rejects(()=>c.execute(p.agent,{op:'authorize',policy:p.key,id:'large'+sequence,amount:'61'}),/spending limit/);
  await c.authorize(p.key,'capA'+sequence,'60');await assert.rejects(()=>c.authorize(p.key,'capB'+sequence,'41'),/spending limit/);assert.equal((await c.policy(p.key)).reserved,'60');await c.authorize(p.key,'capC'+sequence,'40');await assert.rejects(()=>c.execute(p.agent,{op:'authorize',policy:p.key,id:'capD'+sequence,amount:'1'}),/spending limit/);
 });
 await test('settled spend continues to consume lifetime budget',async()=>{
  const p=await position({funded:'200'});const a=await c.authorize(p.key,'spent'+sequence,'60');await c.dispatch(a.key);await assert.rejects(()=>c.authorize(p.key,'spent2'+sequence,'41'),/spending limit/);assert.equal((await c.policy(p.key)).spent,'60');
 });
 await test('signed wrong-agent and wrong-owner transactions fail',async()=>{
  const p=await position();await assert.rejects(()=>c.execute('intruder.synthetic',{op:'authorize',policy:p.key,id:'evil',amount:'1'}),/agent unauthorized/);await assert.rejects(()=>c.execute('bob.synthetic',{op:'revoke',policy:p.key}),/owner unauthorized/);assert.equal((await c.policy(p.key)).reserved,'0');
 });
 await test('expiry enforced by real block timestamp',async()=>{
  const now=Math.floor(Date.parse((await sandbox.rpc.verify()).sync_info.latest_block_time)/1000);const id='expires'+(++sequence);const r=await c.execute('alice.synthetic',{op:'create',id,agent:'agent.synthetic',chain:'base',asset:'SYNTH-USD',recipient:'merchant',per_payment:'1',budget:'1',expires:now+3});
  while(Math.floor(Date.parse((await sandbox.rpc.verify()).sync_info.latest_block_time)/1000)<now+3)await pause(100);
  await assert.rejects(()=>c.execute('agent.synthetic',{op:'authorize',policy:r.key,id,amount:'1'}),/policy inactive/);
 });
 await test('duplicate authorization and dispatch deliver tokens once',async()=>{
  const p=await position(),before=await balance('merchant');const a=await c.authorize(p.key,'dup'+sequence,'60');for(let i=0;i<3;i++){assert.equal((await c.authorize(p.key,a.id,'60')).key,a.key);await c.dispatch(a.key);await c.reconcile(a.key);}assert.equal(await balance('merchant')-before,60n);assert.equal(c.get('positions',p.key).principal,'40');
 });
 await test('id reuse cannot change amount or select another policy',async()=>{
  const p=await position(),q=await position();const a=await c.authorize(p.key,'bound'+sequence,'10');await assert.rejects(()=>c.authorize(p.key,a.id,'11'),/conflict/);await assert.rejects(()=>c.execute(q.agent,{op:'authorize',policy:q.key,id:a.id,amount:'10'}),/idempotency conflict/);
 });
 await test('agent cannot forge a settlement resolution',async()=>{
  const p=await position(),a=await c.authorize(p.key,'resolve'+sequence,'60');await assert.rejects(()=>c.execute(p.agent,{op:'resolve',payment:a.key,outcome:'delivered'}),/resolver unauthorized/);assert.equal((await c.policy(p.key)).reserved,'60');
 });
 await test('missing receipt remains unknown and reserved',async()=>{
  const p=await position(),a=await c.authorize(p.key,'unknown'+sequence,'60');assert.equal(await c.reconcile(a.key),'unknown');assert.equal((await c.policy(p.key)).reserved,'60');assert.equal(await balance(p.address),100n);
 });
 await test('unsolicited tokens excluded from principal and recovery',async()=>{
  const p=await position({funded:'20'});await mint('intruder.synthetic',900);await sandbox.rpc.call('intruder.synthetic','usd.synthetic','fenced_transfer',{id:'unsolicited'+sequence,binding:'b'.repeat(64),recipient:p.address,amount:'900',cancel:false},'1');assert.equal(await balance(p.address),920n);
  await assert.rejects(()=>c.authorize(p.key,'excess'+sequence,'21'),/principal/);const before=await balance(p.owner);await c.recover(p.key);assert.equal(await balance(p.owner)-before,20n);assert.equal(await balance(p.address),900n);
 });
 await test('policy creation and custody setup resume idempotently after interruption',async()=>{
  const now=Math.floor(Date.parse((await sandbox.rpc.verify()).sync_info.latest_block_time)/1000),opts={id:'createcrash'+(++sequence),expires:now+3600};c.crash='after_policy_creation';await assert.rejects(()=>c.create(opts,a=>sandbox.account(a)),Interrupted);reopen();const p=await c.create(opts,a=>sandbox.account(a));await sandbox.account(p.address);await mint(p.owner,100);await c.fund(p.key);assert.equal(await balance(p.address),100n);await c.recover(p.key);
 });
 await test('funding receipt survives interrupted acknowledgement',async()=>{
  const now=Math.floor(Date.parse((await sandbox.rpc.verify()).sync_info.latest_block_time)/1000);const p=await c.create({id:'fund'+(++sequence),expires:now+3600},a=>sandbox.account(a));await mint(p.owner,100);c.crash='after_funding';await assert.rejects(()=>c.fund(p.key),Interrupted);reopen();await c.fund(p.key);assert.equal(await balance(p.address),100n);
 });
 await test('authorization receipt survives process death before journal acknowledgement',async()=>{
  const p=await position();await hardCrash('after_authorization','authorize',[p.key,'authcrash'+sequence,'60']);assert.equal((await c.policy(p.key)).reserved,'60');reopen();const a=await c.authorize(p.key,'authcrash'+sequence,'60');assert.equal(a.status,'reserved');assert.equal((await c.policy(p.key)).reserved,'60');await c.recover(p.key);
 });
 await test('interruption before send leaves an unknown payment, then one delivery',async()=>{
  const p=await position(),a=await c.authorize(p.key,'before'+sequence,'60'),before=await balance('merchant');c.crash='before_send';await assert.rejects(()=>c.dispatch(a.key),Interrupted);reopen();assert.equal(await c.reconcile(a.key),'unknown');await c.dispatch(a.key);assert.equal(await balance('merchant')-before,60n);
 });
 await test('process death after token transfer plus node restart reconciles once',async()=>{
  const p=await position(),a=await c.authorize(p.key,'killed'+sequence,'60'),before=await balance('merchant');await hardCrash('after_transfer','dispatch',[a.key]);await sandbox.restart();reopen();await c.reconcile(a.key);await c.recover(p.key);assert.equal(await balance('merchant')-before,60n);assert.equal(await balance(p.address),0n);assert.equal((await c.policy(p.key)).spent,'60');
 });
 await test('interruption after policy resolution does not debit principal twice',async()=>{
  const p=await position(),a=await c.authorize(p.key,'resolved'+sequence,'60');c.crash='after_policy_resolution';await assert.rejects(()=>c.dispatch(a.key),Interrupted);reopen();await c.reconcile(a.key);await c.reconcile(a.key);assert.equal(c.get('positions',p.key).principal,'40');
 });
 for(const stage of ['after_freeze','after_cancel','after_recovery_transfer'])await test('interrupted recovery resumes safely: '+stage,async()=>{
  const p=await position(),a=await c.authorize(p.key,'recovery'+sequence,'60'),before=await balance(p.owner);c.crash=stage;await assert.rejects(()=>c.recover(p.key),Interrupted);reopen();await assert.rejects(()=>c.authorize(p.key,'new'+sequence,'1'),/frozen/);await c.recover(p.key);await c.recover(p.key);assert.equal(await balance(p.owner)-before,100n);
  const receipt=await sandbox.rpc.call(p.address,'usd.synthetic','fenced_transfer',c.envelope(p,a),'1');assert.equal(receipt.outcome,'cancelled');assert.equal(await balance(p.address),0n);
 });
 await test('process death after recovery transfer cannot cause a second refund',async()=>{
  const p=await position(),before=await balance(p.owner);await c.authorize(p.key,'refundcrash'+sequence,'60');await hardCrash('after_recovery_transfer','recover',[p.key,p.owner]);reopen();await c.recover(p.key);assert.equal(await balance(p.owner)-before,100n);
 });
 await test('node unavailable cannot release reservations or authorize recovery transfer',async()=>{
  const p=await position(),a=await c.authorize(p.key,'offline'+sequence,'60');await sandbox.stop();await assert.rejects(()=>c.reconcile(a.key),/RPC unavailable/);await assert.rejects(()=>c.recover(p.key),/RPC unavailable/);assert.equal(c.get('positions',p.key).principal,'100');assert.equal(c.get('payments',a.key).status,'reserved');await sandbox.start();await c.recover(p.key);assert.equal(await balance(p.address),0n);
 });
 await test('real token cancellation fence rejects changed recipient or amount',async()=>{
  const p=await position(),a=await c.authorize(p.key,'fence'+sequence,'60');await c.recover(p.key);for(const mutation of [{recipient:'othermerchant'},{amount:'59'}])await assert.rejects(()=>sandbox.rpc.call(p.address,'usd.synthetic','fenced_transfer',{...c.envelope(p,a),...mutation},'1'),/idempotency conflict/);
 });
 await test('terminal settlement cannot flip from delivered to cancelled',async()=>{
  const p=await position(),a=await c.authorize(p.key,'terminal'+sequence,'60');await c.dispatch(a.key);await assert.rejects(()=>c.execute('resolver.synthetic',{op:'resolve',payment:a.key,outcome:'cancelled'}),/conflicting settlement/);assert.equal((await c.policy(p.key)).spent,'60');
 });
 await test('concurrent authorization attempts cannot exceed NEAR budget',async()=>{
  const p=await position({funded:'200'});const r=await Promise.allSettled([c.execute(p.agent,{op:'authorize',policy:p.key,id:'raceA'+sequence,amount:'60'}),c.execute(p.agent,{op:'authorize',policy:p.key,id:'raceB'+sequence,amount:'60'})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await c.policy(p.key)).reserved,'60');
 });
 await test('unknown finality and real-asset configuration fail closed',async()=>{
  await assert.rejects(()=>c.create({id:'real',asset:'USDC',expires:9999999999},()=>{}),/synthetic asset/);assert.throws(()=>new LocalNear(3030,'mainnet'),/local sandbox/);const wrong=new LocalNear(sandbox.port,'mh-synthetic-wrong');await assert.rejects(()=>wrong.call('synthetic','usd.synthetic','mint',{account:'merchant',amount:'1'}),/wrong chain/);
 });
 const summary={repo:'MultiHopper1/multihopper',scope:'Real local nearcore 2.14.0, deployed WASM policy and synthetic token fixtures; no MPC or public chain',chainId:sandbox.chainId,passed:results.length,failed:0,seconds:(Date.now()-start)/1000,tests:results,transactions:sandbox.rpc.receipts.length,network:'loopback only',assets:'synthetic only'};
 rmSync(join(out,'FAILURE.json'),{force:true});rmSync(join(out,'node-failure.log'),{force:true});
 writeFileSync(join(out,'SUMMARY.json'),JSON.stringify(summary,null,2)+'\n');writeFileSync(join(out,'RECEIPTS.json'),JSON.stringify(sandbox.rpc.receipts,null,2)+'\n');console.log('SANDBOX_RESULT '+JSON.stringify(summary));
}catch(e){writeFileSync(join(out,'FAILURE.json'),JSON.stringify({error:e.message,tests:results},null,2));if(sandbox)writeFileSync(join(out,'node-failure.log'),readFileSync(join(sandbox.directory,'node.log')));console.error(e);process.exitCode=1;}
finally{if(c)c.close();if(sandbox)await sandbox.cleanup();}
