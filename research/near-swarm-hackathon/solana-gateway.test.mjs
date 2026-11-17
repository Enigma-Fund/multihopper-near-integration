import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {once} from 'node:events';

const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){let n=BigInt('0x'+bytes.toString('hex')),out='';while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}for(const b of bytes){if(b)break;out='1'+out;}return out;}
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function login(base){const keys=generateKeyPairSync('ed25519');const address=base58(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32));const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});let r=await post('/api/auth/challenge',{address}),c=await r.json();r=await post('/api/auth/confirm',{address,nonce:c.nonce,signature:sign(null,Buffer.from(c.message),keys.privateKey).toString('hex')});assert.equal(r.status,200);return {address,cookie:r.headers.get('set-cookie').split(';')[0]};}
test('Solana test lookup only reveals the signed-in source owner’s test transfer',async()=>{
 let aliceAddress;const upstream=createServer((req,res)=>{assert.equal(req.headers['x-api-key'],'mh_test_synthetic_only');res.setHeader('content-type','application/json');res.end(JSON.stringify({id:12,status:'completed',tokenSymbol:'SYNTH',amountRaw:'25',sourceOwner:aliceAddress,isTest:req.url!=='/api/v1/transfers/13',route:['private'],recipientWallet:'private'}));});const upstreamPort=await listen(upstream);
 const reservation=createServer();const appPort=await listen(reservation);await new Promise(r=>reservation.close(r));
 const app=spawn(process.execPath,['research/near-swarm-hackathon/server.mjs'],{env:{...process.env,PORT:String(appPort),DEMO_NEAR:'0',MH_SOLANA_TEST_API_URL:`http://127.0.0.1:${upstreamPort}/api/v1`,MH_SOLANA_TEST_API_KEY:'mh_test_synthetic_only'},stdio:['ignore','pipe','pipe']});
 try {await Promise.race([once(app.stdout,'data'),once(app,'exit').then(()=>{throw Error('App exited before ready');})]);const base=`http://127.0.0.1:${appPort}`;const alice=await login(base),bob=await login(base);aliceAddress=alice.address;
  assert.equal((await fetch(base+'/api/solana/transfers/12')).status,401);
  let r=await fetch(base+'/api/solana/transfers/12',{headers:{cookie:alice.cookie}});assert.equal(r.status,200);let body=await r.json();assert.deepEqual(body,{transfer:{id:12,status:'completed',tokenSymbol:'SYNTH',amountRaw:'25',isTest:true}});
  r=await fetch(base+'/api/solana/transfers/12',{headers:{cookie:bob.cookie}});assert.equal(r.status,404);
  r=await fetch(base+'/api/solana/transfers/13',{headers:{cookie:alice.cookie}});assert.equal(r.status,404);
 }finally{app.kill('SIGTERM');await new Promise(r=>upstream.close(r));}
});
