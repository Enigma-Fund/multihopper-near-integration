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
const actions = ['create','close','read'];
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
  fields.push('Expires: '+new Date(expires).toISOString());
  return fields.join('\n');
}

export async function order(db, origin, body, now = Date.now()) {
  const message = signedMessage(origin, body, now);
  if (typeof body.signature !== 'string' || !/^[a-f0-9]{128}$/.test(body.signature)) throw Error('A signed wallet message is required');
  const key = await crypto.subtle.importKey('raw', fromBase58(body.owner,32), {name:'Ed25519'}, false, ['verify']);
  const bytes = Uint8Array.from(body.signature.match(/../g), x => parseInt(x,16));
  if (!await crypto.subtle.verify('Ed25519', key, bytes, encoder.encode(message))) throw Error('Wallet signature verification failed');
  if (body.action === 'create') {
    await db.prepare('INSERT INTO swarm_orders(owner,id,recipient,budget,cap) VALUES(?,?,?,?,?) ON CONFLICT(owner,id) DO NOTHING')
      .bind(body.owner,body.id,body.recipient,body.budget,body.limit).run();
  }
  if (body.action === 'close') {
    await db.prepare("UPDATE swarm_orders SET state='closed' WHERE owner=? AND id=?").bind(body.owner,body.id).run();
  }
  const row = await db.prepare('SELECT id,recipient,budget,cap,state FROM swarm_orders WHERE owner=? AND id=?').bind(body.owner,body.id).first();
  if (!row) throw Error('Job not found for this wallet');
  if (body.action === 'create' && (row.recipient !== body.recipient || row.budget !== body.budget || row.cap !== body.limit)) throw Error('Existing job has different terms');
  return row;
}
