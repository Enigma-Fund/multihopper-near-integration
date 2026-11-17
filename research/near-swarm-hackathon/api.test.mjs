import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

let base=process.env.DEMO_TEST_BASE,child;
before(async()=>{
 if(base){
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('The synthetic lifecycle check requires a loopback service.');
  return;
 }
 child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{
  env:{PATH:process.env.PATH,PORT:'0'},stdio:['ignore','pipe','inherit']
 });
 const startup=AbortSignal.timeout(10000);
 base=await new Promise((resolve,reject)=>{
  let buffer='';
  const fail=()=>reject(Error('Disposable job server failed to start'));
  child.once('error',reject);child.once('exit',fail);startup.addEventListener('abort',fail,{once:true});
  child.stdout.on('data',data=>{
   buffer+=data;
   const url=buffer.match(/Synthetic demo at (http:\/\/127\.0\.0\.1:\d+)\n/);
   if(url){startup.removeEventListener('abort',fail);child.off('exit',fail);resolve(url[1]);}
  });
 });
});
after(async()=>{
 if(child && child.exitCode===null && child.signalCode===null){
  const stopped=once(child,'exit');
  child.kill('SIGTERM');
  await stopped;
 }
});
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
 let n=BigInt('0x'+bytes.toString('hex')), out='';
 while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}
 for(const b of bytes){if(b)break;out='1'+out;}
 return out;
}
async function post(path,body,cookie){
 const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],...await r.json()};
}
async function login() {
 const pair=generateKeyPairSync('ed25519');
 const address=base58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 const challenge=await post('/api/auth/challenge',{address});
 const signature=sign(null,Buffer.from(challenge.message),pair.privateKey).toString('hex');
 const result=await post('/api/auth/confirm',{address,nonce:challenge.nonce,signature});
 assert.equal(result.status,200);
 assert.equal((await post('/api/auth/confirm',{address,nonce:challenge.nonce,signature})).status,400);
 return {address,cookie:result.cookie};
}
test('wallet authentication, segregation, idempotency, limits and recovery',async()=>{
 const id=randomUUID().slice(0,8), a=await login(), b=await login();
 assert.equal((await post('/api/live/jobs',{})).status,401);
 assert.equal((await post('/api/live/jobs',{},a.cookie)).status,503);
 const duplicate=await Promise.all([post('/api/jobs',{jobId:id,budget:'100',limit:'25'},a.cookie),post('/api/jobs',{jobId:id,budget:'100',limit:'25'},a.cookie)]);
 assert.deepEqual(duplicate.map(x=>x.status).sort(),[200,400]);
 assert.equal((await post('/api/jobs',{jobId:id+'b',budget:'100',limit:'25'},b.cookie)).status,200);
 assert.equal((await post('/api/payments',{jobId:id,invoiceId:'bad',amount:'26'},a.cookie)).status,400);
 const pay={jobId:id,invoiceId:'one',amount:'20'};
 assert.equal((await post('/api/payments',pay,a.cookie)).job.remaining,'80');
 assert.equal((await post('/api/payments',pay,a.cookie)).job.remaining,'80');
 assert.equal((await post('/api/payments',{...pay,amount:'21'},a.cookie)).status,400);
 assert.equal((await post('/api/recover',{owner:a.address,jobId:id},b.cookie)).status,400);
 assert.equal((await post('/api/recover',{jobId:id},a.cookie)).job.returned,'80');
 assert.equal((await post('/api/recover',{jobId:id+'b'},b.cookie)).job.returned,'100');
});

