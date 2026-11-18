import {reconcilePending} from './durable.mjs';
export async function reconcileTrigger(request,db,services){
 const token=request.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
 if(!token)return {status:401,body:{error:'Unauthorized'}};
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 const allowed=await db.prepare('SELECT id FROM swarm_reconcile_control WHERE id=1 AND token_hash=?').bind(hash).first();
 if(!allowed)return {status:401,body:{error:'Unauthorized'}};
 const results=await reconcilePending(db,services);
 await db.prepare('UPDATE swarm_reconcile_control SET last_run=?,last_count=? WHERE id=1').bind(Date.now(),results.length).run();
 return {status:200,body:{checked:results.length}};
}
