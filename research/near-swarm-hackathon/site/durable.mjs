import {observeSettlement} from './settlement.mjs';
// Read-only reconciliation: never prepare, sign, fund or broadcast transactions.
// Invoice rows are the durable queue, so a missed webhook cannot lose work.
export async function reconcilePending(db,services,{now=Date.now(),limit=25,observe=observeSettlement}={}){
 const rows=await db.prepare('SELECT i.external_id,i.transfer_id FROM swarm_invoices i LEFT JOIN swarm_reconcile r ON r.reference=i.external_id WHERE i.transfer_id IS NOT NULL AND i.outcome IS NULL AND (r.due IS NULL OR r.due<=?) AND (r.until IS NULL OR r.until<=?) ORDER BY COALESCE(r.due,0),i.rowid LIMIT ?').bind(now,now,limit).all();
 const results=[];
 for(const row of rows.results){
  await db.prepare('INSERT INTO swarm_reconcile(reference,due,attempts) VALUES(?,0,0) ON CONFLICT DO NOTHING').bind(row.external_id).run();
  const lease=crypto.randomUUID();
  const claim=await db.prepare('UPDATE swarm_reconcile SET lease=?,until=?,attempts=attempts+1 WHERE reference=? AND due<=? AND (until IS NULL OR until<=?)').bind(lease,now+60000,row.external_id,now,now).run();
  if(!Number(claim.meta.changes))continue;
  let state='pending';
  try{
   const r=await observe(db,services,{externalId:row.external_id,transferId:row.transfer_id});
   state=['payout-confirmed','recovery-credit-confirmed'].includes(r?.status)?'confirmed':'pending';
  }catch{state='retry';}
  // Fencing prevents a stale worker from overwriting a newer worker's progress.
  await db.prepare('UPDATE swarm_reconcile SET lease=NULL,until=NULL,due=?,status=? WHERE reference=? AND lease=?').bind(now+30000,state,row.external_id,lease).run();
  results.push({reference:row.external_id,status:state});
 }
 return results;
}
