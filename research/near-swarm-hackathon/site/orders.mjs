// Wallet-signed orders describe work and limits. Signing an order spends no tokens.
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const encoder = new TextEncoder();

export function fromBase58(value, length) {
  if (typeof value !== 'string' || !value.length || value.length > length * 1.4 + 1) throw Error('Invalid address or signature');
  let n = 0n;
  for (const c of value) {
    const i = alphabet.indexOf(c);
    if (i < 0) throw Error('Invalid base58 character');
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of value) { if (c !== '1') break; bytes.unshift(0); }
  if (bytes.length !== length) throw Error('Incorrect address or signature length');
  return Uint8Array.from(bytes);
}

export const JOB_MINT = 'So11111111111111111111111111111111111111112';
const actions = ['create','close','close-near','read','link','invoice','refresh','prepare-refund','prepare-wallet','wallet-step','wallet-run','publish-receipt','share-receipt','revoke-receipt','cancel-job'];
export function signedMessage(origin, request, now = Date.now()) {
  const {action, owner, id, expires} = request;
  if (!actions.includes(action) || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id)) throw Error('Invalid job action or ID');
  fromBase58(owner, 32);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + 300000) throw Error('Signature request expired or invalid');
  const fields = ['MultiHopper | Swarm for Hire', 'Sign a work order. This message cannot transfer funds.',
    'Site: '+origin, 'Action: '+action, 'Owner: '+owner, 'Job: '+id];
  if (action === 'create') {
    fromBase58(request.recipient, 32);
    if (!['budget','limit'].every(k => typeof request[k] === 'string' && /^[1-9]\d{0,17}$/.test(request[k])) ||
        BigInt(request.limit) > BigInt(request.budget)) throw Error('Enter a positive budget and a per-payment limit within the budget');
    fields.push('Agent payout address: '+request.recipient, 'Asset: native SOL', 'Budget (lamports): '+request.budget, 'Per payment (lamports): '+request.limit);
  }
  if(action==='cancel-job')fields.push('Stop new workspace payments for this job. Already submitted chain transactions may complete. Recover only API-eligible funds.');
  if(action==='share-receipt')fields.push('Publish this invoice’s verified outcome, credited amount and transaction signatures to anyone with the share link.');
  if(action==='link'){
    if(typeof request.nearOwner!=='string' || !/^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(request.nearOwner) ||
       typeof request.nearJobId!=='string' || !/^[A-Za-z0-9_-]{1,48}$/.test(request.nearJobId))throw Error('Invalid NEAR account or job ID');
    fields.push('NEAR account: '+request.nearOwner,'NEAR job: '+request.nearJobId);
  }
  if(['invoice','refresh','prepare-refund','prepare-wallet','wallet-step','wallet-run','publish-receipt','share-receipt','revoke-receipt'].includes(action)){
    if(typeof request.invoice!=='string' || !/^[A-Za-z0-9_-]{1,48}$/.test(request.invoice))throw Error('Enter an invoice ID of up to 48 letters, numbers, underscores or hyphens');
    fields.push('Invoice: '+request.invoice);
    if(action==='invoice'){
      fromBase58(request.recipient,32);
      for(const field of ['amount','minimum'])if(typeof request[field]!=='string'||!/^[1-9]\d{0,17}$/.test(request[field]))throw Error('Invalid payment amount');
      if(BigInt(request.minimum)>BigInt(request.amount))throw Error('Minimum payout exceeds the gross charge');
      fields.push('Request a quote for native SOL.','Agent payout address: '+request.recipient,'Gross charge (lamports): '+request.amount,'Minimum agent payout (lamports): '+request.minimum);
    }
    if(action==='prepare-wallet'||action==='wallet-step'||action==='wallet-run'){
      if(!['payment','recovery'].includes(request.mode)||typeof request.extra!=='string'||!/^\d{1,15}$/.test(request.extra))throw Error('Invalid wallet cost limit');
      fields.push('Wallet operation: '+request.mode,'Maximum additional wallet costs (lamports): '+request.extra);
      if(action==='wallet-run')fields.push('Scope: prepare, store signed transactions and resume this invoice only. Each transaction still requires a wallet signature.');
      // Signed transaction bytes are verified independently against the authenticated API bundle.
    }
    if(request.refundSignatures!==undefined){
      if(action!=='refresh'||!Array.isArray(request.refundSignatures)||!request.refundSignatures.length||request.refundSignatures.length>12)throw Error('Invalid recovery signatures');
      for(const sig of request.refundSignatures)fromBase58(sig,64);
      fields.push('Recovery transactions: '+request.refundSignatures.join(','));
    }
  }
  fields.push('Expires: '+new Date(expires).toISOString());
  return fields.join('\n');
}

export async function verifyOrderSignature(origin, body, now = Date.now()) {
  const message = signedMessage(origin, body, now);
  if (typeof body.signature !== 'string' || !/^[a-f0-9]{128}$/.test(body.signature)) throw Error('A signed wallet message is required');
  const key = await crypto.subtle.importKey('raw', fromBase58(body.owner,32), {name:'Ed25519'}, false, ['verify']);
  const bytes = Uint8Array.from(body.signature.match(/../g), x => parseInt(x,16));
  if (!await crypto.subtle.verify('Ed25519', key, bytes, encoder.encode(message))) throw Error('Wallet signature verification failed');
}
export function approvalRecord(db,origin,body,item='',reference){
  const evidence={origin,acceptedAt:Date.now(),expires:body.expires,message:signedMessage(origin,body),signature:body.signature};
  if(body.action==='link')evidence.nearProof=body.nearProof;
  const checks={create:['SELECT 1 FROM swarm_orders WHERE owner=? AND id=? AND recipient=? AND budget=? AND cap=?',[body.recipient,body.budget,body.limit]],
    link:['SELECT 1 FROM swarm_near_links WHERE owner=? AND id=? AND job_key=?',[reference]],invoice:['SELECT 1 FROM swarm_invoices WHERE owner=? AND id=? AND external_id=?',[reference]]};
  const [predicate,values]=checks[body.action];
  return db.prepare('INSERT INTO swarm_approvals(owner,id,kind,item,statement) SELECT ?,?,?,?,? WHERE EXISTS ('+predicate+') ON CONFLICT DO NOTHING')
    .bind(body.owner,body.id,body.action,item,JSON.stringify(evidence),body.owner,body.id,...values);
}

export async function order(db, origin, body, now = Date.now()) {
  if(!['create','read','close'].includes(body.action))throw Error('Use the settlement endpoint for this action');
  await verifyOrderSignature(origin,body,now);
  if (body.action === 'create') {
    await db.batch([db.prepare('INSERT INTO swarm_orders(owner,id,recipient,budget,cap) VALUES(?,?,?,?,?) ON CONFLICT(owner,id) DO NOTHING')
      .bind(body.owner,body.id,body.recipient,body.budget,body.limit),approvalRecord(db,origin,body)]);
  }
  if (body.action === 'close') {
    await db.prepare("UPDATE swarm_orders SET state='closed' WHERE owner=? AND id=?").bind(body.owner,body.id).run();
  }
  const row = await db.prepare('SELECT id,recipient,budget,cap,state FROM swarm_orders WHERE owner=? AND id=?').bind(body.owner,body.id).first();
  if (!row) throw Error('Job not found for this wallet');
  if (body.action === 'create' && (row.recipient !== body.recipient || row.budget !== body.budget || row.cap !== body.limit)) throw Error('Existing job has different terms');
  return row;
}
