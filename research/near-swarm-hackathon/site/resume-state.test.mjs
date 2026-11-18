import test from 'node:test';
import assert from 'node:assert/strict';
import {resumeStore} from './resume-state.mjs';
function storage(){const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};}
test('refresh restores the exact active invoice, not signatures or confirmation claims',()=>{
 const s=storage(),a=resumeStore(s);a.save('one',{owner:'alice',fields:{'job-id':'job','invoice':'invoice','extra':'0.1'},signature:'secret',confirmed:true});
 const row=resumeStore(s).load();assert.equal(row.fields.invoice,'invoice');assert.equal(row.fields.extra,'0.1');assert.equal(row.owner,'alice');assert.equal(row.signature,undefined);assert.equal(row.confirmed,undefined);
});
test('explicit new job preserves previous jobs and selected job resumes after refresh',()=>{
 const s=storage(),a=resumeStore(s);a.save('one',{fields:{'job-id':'job','invoice':'invoice'}});a.save('two',{fields:{}});
 assert.equal(a.load().key,'two');assert.equal(a.list().length,2);a.select('one');assert.equal(resumeStore(s).load().fields.invoice,'invoice');assert.throws(()=>a.select('missing'));
});
test('corrupt or unavailable storage never invents payment progress',()=>{
 assert.equal(resumeStore({getItem:()=>'{bad'}).load(),null);
 assert.equal(resumeStore({getItem:()=>{throw Error();}}).load(),null);
});
