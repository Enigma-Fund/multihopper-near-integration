const test=require('node:test');
const assert=require('node:assert/strict');
const {SwarmDemo}=require('./engine.cjs');
test('separate customers, limits, idempotency and failed-job recovery',()=>{
 const d=new SwarmDemo();
 d.create('alice','a','100','25');
 d.create('bob','b','100','25');
 assert.throws(()=>d.pay('alice','a','invoice','26'),/limit/);
 d.pay('alice','a','invoice','20');
 d.pay('alice','a','invoice','20');
 assert.equal(d.jobs.get('a').spent,20n);
 assert.throws(()=>d.pay('alice','a','invoice','21'),/bound/);
 assert.throws(()=>d.pay('bob','a','new-invoice','10'),/customer/);
 d.fail('alice','a');
 assert.equal(d.jobs.get('a').returned,80n);
 assert.equal(d.jobs.get('b').remaining,100n);
 assert.throws(()=>d.pay('alice','a','next','1'),/Active/);
 assert.equal(d.fail('alice','a').returned,80n);
});

