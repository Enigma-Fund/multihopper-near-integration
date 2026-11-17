import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {OperationJournal} from './operation-journal.mjs';
const op={key:'operation_123',owner:'wallet_A',method:'POST',path:'/transfers',body:{amountRaw:'100',recipient:'wallet_B'}};
test('records once across concurrent callers, rejects changed bindings and survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'swarm-journal-'));const db=join(dir,'journal.db');const a=new OperationJournal(db),b=new OperationJournal(db);let release,count=0;const pending=a.run(op,()=>{count++;return new Promise(r=>{release=r;});});
 await assert.rejects(()=>b.run(op,()=>{count++;}),/reconciliation required/);release({transfer:{id:4}});assert.deepEqual(await pending,{transfer:{id:4}});a.close();b.close();
 const reopened=new OperationJournal(db);try{assert.deepEqual(await reopened.run(op,()=>{count++;}),{transfer:{id:4}});assert.equal(count,1);await assert.rejects(()=>reopened.run({...op,body:{...op.body,amountRaw:'101'}},()=>{}),/conflicts/);await assert.rejects(()=>reopened.run({...op,owner:'wallet_C'},()=>{}),/conflicts/);}finally{reopened.close();rmSync(dir,{recursive:true,force:true});}
});
test('lost response remains uncertain after restart and is never resent',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'swarm-journal-'));const db=join(dir,'journal.db');let count=0;let a=new OperationJournal(db);
 try{await assert.rejects(()=>a.run(op,async()=>{count++;throw Error('connection lost');}),/connection lost/);a.close();a=new OperationJournal(db);await assert.rejects(()=>a.run(op,async()=>{count++;}),/reconciliation required/);assert.equal(count,1);}finally{a.close();rmSync(dir,{recursive:true,force:true});}
});
test('a process crash after submission cannot cause an automatic duplicate',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'swarm-journal-'));const db=join(dir,'journal.db');
 const moduleUrl=pathToFileURL(join(process.cwd(),'research/near-swarm-hackathon/operation-journal.mjs')).href;
 const script=`import {OperationJournal} from ${JSON.stringify(moduleUrl)}; const j=new OperationJournal(${JSON.stringify(db)}); await j.run(${JSON.stringify(op)},async()=>process.exit(73));`;
 try{const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});assert.equal(child.status,73);const j=new OperationJournal(db);let sent=0;try{await assert.rejects(()=>j.run(op,async()=>{sent++;}),/reconciliation required/);assert.equal(sent,0);}finally{j.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});
