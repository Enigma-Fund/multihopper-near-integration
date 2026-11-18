import {test} from 'node:test';
import assert from 'node:assert/strict';
import {store} from '../test-fixtures/settlement-db.mjs';
import {reconcileTrigger} from './reconcile-trigger.mjs';
import {createHash} from 'node:crypto';
test('scheduler requires scoped secret and records empty successful run without funding',async()=>{
 const db=store(),token='ab'.repeat(32),hash=createHash('sha256').update(token).digest('hex');
 await db.prepare('INSERT INTO swarm_reconcile_control(id,token_hash) VALUES(1,?)').bind(hash).run();
 const services=new Proxy({}, {get(){throw Error('No funding or API method should be called');}});
 for(const auth of ['', 'Bearer '+ 'cd'.repeat(32)])assert.equal((await reconcileTrigger(new Request('https://example/api/reconcile',{headers:{authorization:auth}}),db,services)).status,401);
 assert.deepEqual(await reconcileTrigger(new Request('https://example/api/reconcile',{headers:{authorization:'Bearer '+token}}),db,services),{status:200,body:{checked:0}});
 assert((await db.prepare('SELECT last_run FROM swarm_reconcile_control WHERE id=1').bind().first()).last_run>0);
});
