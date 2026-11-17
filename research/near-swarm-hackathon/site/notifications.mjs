// The dedicated workspace registers one fixed callback. No request controls its URL or subscriptions.
export const notificationOrigin='https://multihopper-swarm-for-hire.pages.dev';
export async function notificationKey(env,services,provision=false){
  if(env.SWARM_HOOK_SECRET)return env.SWARM_HOOK_SECRET;
  const db=env.SWARM_JOBS;
  if(!db||!env.SWARM_SOLANA_API_KEY)throw Error('No notification storage');
  const read=()=>db.prepare('SELECT nonce,ciphertext FROM swarm_notification_key WHERE id=1').bind().first();
  const encoder=new TextEncoder();
  const material=await crypto.subtle.importKey('raw',encoder.encode(env.SWARM_SOLANA_API_KEY),'HKDF',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',info:encoder.encode('webhook-secret-v1'),salt:encoder.encode(notificationOrigin)},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const pack=b=>btoa(String.fromCharCode(...new Uint8Array(b))), unpack=s=>Uint8Array.from(atob(s),v=>v.charCodeAt(0));
  let record=await read();
  if(!record && provision){
    const url=notificationOrigin+'/near-swarm/api/notifications';
    const registered=await services.registerNotifications({url,events:['transfer.completed','transfer.rescued','transfer.refunded']});
    if(registered?.url!==url||!registered.isActive||!/^[0-9a-f]{64}$/.test(registered.secret))throw Error('Invalid notification registration');
    const nonce=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,encoder.encode(registered.secret));
    await db.prepare('INSERT INTO swarm_notification_key(id,nonce,ciphertext) VALUES(1,?,?) ON CONFLICT DO NOTHING').bind(pack(nonce),pack(cipher)).run();record=await read();
  }
  if(!record)throw Error('Notification registration pending');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unpack(record.nonce)},key,unpack(record.ciphertext)));
}
