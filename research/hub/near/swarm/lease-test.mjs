import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function leaseTest(){
 const dir=mkdtempSync(join(tmpdir(),'mh-swarm-lease-')),children=[];
 const launch=()=>{const child=spawn(process.execPath,[fileURLToPath(new URL('./lease-worker.mjs',import.meta.url)),dir],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','ignore']});children.push(child);const exit=new Promise((r,j)=>{child.once('exit',r);child.once('error',j);});const ready=Promise.race([new Promise(r=>child.stdout.once('data',()=>r('locked'))),exit.then(()=> 'rejected')]);return {child,exit,ready};};
 try{
  const first=launch();assert.equal(await first.ready,'locked');const competing=launch();assert.equal(await competing.ready,'rejected');assert.equal(await competing.exit,2);
  first.child.kill('SIGKILL');await first.exit;
  // Simultaneous recovery after abrupt death: exactly one owner, no stale PID reclamation.
  const a=launch(),b=launch();const outcomes=await Promise.all([a.ready,b.ready]);assert.deepEqual([...outcomes].sort(),['locked','rejected']);const winner=outcomes[0]==='locked'?a:b;winner.child.kill('SIGTERM');assert.equal(await winner.exit,0);
  const reopened=launch();assert.equal(await reopened.ready,'locked');reopened.child.kill('SIGTERM');assert.equal(await reopened.exit,0);
 }finally{for(const c of children)if(c.exitCode===null&&c.signalCode===null)c.kill('SIGKILL');await Promise.all(children.map(c=>(c.exitCode!==null||c.signalCode!==null)?Promise.resolve():new Promise(r=>c.once('exit',r))));rmSync(dir,{recursive:true,force:true});}
}
