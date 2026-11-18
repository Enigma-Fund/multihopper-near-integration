import {verifyOrderSignature} from './orders.mjs';
export async function shareReceipt(db,origin,body){
 await verifyOrderSignature(origin,body);
 if(!['share-receipt','revoke-receipt'].includes(body.action))throw Error('Invalid receipt action');
 const row=await db.prepare('SELECT external_id,outcome,received,evidence FROM swarm_invoices WHERE owner=? AND id=? AND invoice=?').bind(body.owner,body.id,body.invoice).first();
 if(!row?.outcome||!row.evidence)throw Error('A verified final receipt is required');
 if(body.action==='revoke-receipt'){
  await db.prepare('DELETE FROM swarm_shared_receipts WHERE reference=?').bind(row.external_id).run();return {status:'revoked'};
 }
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 // Consent is per invoice. Do not publish signed orders, owners, route IDs or job names.
 const payload=JSON.stringify({version:1,network:'solana:mainnet',outcome:row.outcome,creditedLamports:row.received,
  signatures:JSON.parse(row.evidence).map(r=>r.signature),attestor:'MultiHopper',scope:'Verified Solana settlement; not a TRM-issued certificate'});
 await db.prepare('INSERT INTO swarm_shared_receipts(reference,token,payload) VALUES(?,?,?) ON CONFLICT(reference) DO NOTHING').bind(row.external_id,token,payload).run();
 const saved=await db.prepare('SELECT token FROM swarm_shared_receipts WHERE reference=?').bind(row.external_id).first();
 return {status:'shared',url:origin+'/near-swarm/receipts/'+saved.token};
}
export async function publicSharedReceipt(db,token){
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const row=await db.prepare('SELECT payload FROM swarm_shared_receipts WHERE token=?').bind(token).first();return row?JSON.parse(row.payload):null;
}
export function sharedReceiptHtml(receipt){
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<!doctype html><meta name="viewport" content="width=device-width"><title>MultiHopper settlement receipt</title><style>body{font:18px system-ui;max-width:850px;margin:60px auto;padding:24px;color:#141236;background:#fafaf6}h1{color:#2414c9}a{overflow-wrap:anywhere}</style><h1>MultiHopper settlement receipt</h1><p>'+escape(receipt.outcome)+'</p><p>Credited: '+escape(receipt.creditedLamports)+' lamports on Solana mainnet.</p>'+receipt.signatures.map(s=>'<p><a href="https://solscan.io/tx/'+encodeURIComponent(s)+'">View transaction '+escape(s)+'</a></p>').join('')+'<p>'+escape(receipt.scope)+'</p><p>Shared by the invoice owner. Blockchain records remain public; revoking this page cannot remove copies or chain history.</p>';
}
