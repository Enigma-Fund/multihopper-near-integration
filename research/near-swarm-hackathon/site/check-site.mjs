// Public HTTPS smoke test. Uses an unfunded disposable key to sign work orders only.
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {signedMessage} from './orders.mjs';
const origin=process.argv[2];
if(!/^https:\/\/(?:business\.multihopper\.com|(?:[a-f0-9]{8}|enigma-near-swarm)\.multihopper-business\.pages\.dev)$/.test(origin)) throw Error('Expected a MultiHopper website origin');
const base=origin+'/near-swarm';
const key=generateKeyPairSync('ed25519');
const pub=key.publicKey.export({format:'der',type:'spki'}).subarray(-32);
function base58(bytes) {
  let n=BigInt('0x'+bytes.toString('hex')),s='';
  while(n){s='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Number(n%58n)]+s;n/=58n;}
  for(const b of bytes){if(b)break;s='1'+s;}return s;
}
const owner=base58(pub), id=randomUUID();
const body={owner,id,recipient:owner,budget:'1000000',limit:'1000',expires:Date.now()+200000};
async function signed(action,changes={}) {
  const data={...body,action,...changes};
  data.signature=sign(null,Buffer.from(signedMessage(origin,data)),key.privateKey).toString('hex');
  return data;
}
async function send(data) {
  const r=await fetch(base+'/api/orders',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
  if(r.headers.get('content-type')?.includes('json'))return [r.status,await r.json()];
  throw Error('Unexpected HTTP response '+r.status);
}
const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/Sign a work order/);
const api=await (await fetch(base+'/api')).json();assert.equal(api.signedJobs,true);
for(const name of ['orders','browser']){const r=await fetch(base+'/'+name+'.mjs');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);}
const create=await signed('create');
assert.equal((await send({...create,limit:'999'}))[0],400);
const first=await send(create);assert.equal(first[0],200,JSON.stringify(first));assert.equal(first[1].job.state,'open');
assert.equal((await send(create))[1].job.id,id);
assert.equal((await send(await signed('read')))[1].job.budget,body.budget);
assert.equal((await send(await signed('close')))[1].job.state,'closed');
assert.equal((await send(create))[1].job.state,'closed');
console.log('Passed public page, API, both browser modules, signature tampering, signed create/read/close, idempotent retry and replay after closure.');
