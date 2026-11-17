import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join, dirname} from 'node:path';
import {WalletSessions} from './auth.mjs';
import {LocalNearJobs} from './near-local.mjs';
import {createSolanaReader} from './solana-reader.mjs';
const require = createRequire(import.meta.url);
const {SwarmDemo} = require('./engine.cjs');
const root = dirname(fileURLToPath(import.meta.url));
const isNear=process.env.DEMO_NEAR === '1';
const demo = isNear ? await LocalNearJobs.start() : new SwarmDemo();
if(isNear) {
  const shutdown=async()=>{server.close();await demo.close();process.exit(0);};
  process.once('SIGTERM',shutdown);
  process.once('SIGINT',shutdown);
}
const port = Number(process.env.PORT || 18988);
const auth = new WalletSessions({origin:`http://127.0.0.1:${port}`});
// The test-only reader is an optional, server-side integration. Never expose its key.
const solanaReader = process.env.MH_SOLANA_TEST_API_URL && process.env.MH_SOLANA_TEST_API_KEY
  ? createSolanaReader({baseUrl:process.env.MH_SOLANA_TEST_API_URL,apiKey:process.env.MH_SOLANA_TEST_API_KEY})
  : null;
const serialize = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
function reply(res,status,data) {
  res.writeHead(status, {'content-type':'application/json', 'cache-control':'no-store'});
  res.end(serialize(data));
}
const server = createServer(async (req,res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if(req.method === 'GET' && (url.pathname === '/' || url.pathname === '/api/docs')) {
    const page = await readFile(join(root,url.pathname === '/' ? 'index.html' : 'api.html'));
    res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(page);
    return;
  }
  if(req.method === 'GET' && url.pathname.startsWith('/api/solana/transfers/')) {
    const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
    if(!token) return reply(res,401,{error:'Wallet session required'});
    if(!solanaReader) return reply(res,503,{error:'Solana test API is not configured'});
    try {
      const owner=auth.owner(token);
      const id=url.pathname.slice('/api/solana/transfers/'.length);
      const transfer=await solanaReader.getTransfer(id);
      // An integration API key may see multiple users' transfers. Never return
      // a result unless the authenticated source owns this test transfer.
      if(transfer?.sourceOwner !== owner || transfer?.isTest !== true) return reply(res,404,{error:'Transfer not found'});
      return reply(res,200,{transfer:{id:transfer.id,status:transfer.status,tokenSymbol:transfer.tokenSymbol,amountRaw:transfer.amountRaw,isTest:true}});
    } catch { return reply(res,404,{error:'Transfer not found'}); }
  }
  if(req.method !== 'POST' || !['/api/jobs','/api/payments','/api/recover','/api/auth/challenge','/api/auth/confirm'].includes(url.pathname)) return reply(res,404,{error:'Not found'});
  if(req.headers['content-type'] !== 'application/json') return reply(res,415,{error:'JSON required'});
  if(req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.address().port}`) return reply(res,403,{error:'Local origin required'});
  let input='';
  try {
    for await(const part of req) {
      input += part;
      if(input.length > 4096) throw Error('Request too large');
    }
    const data=JSON.parse(input);
    if (!data || typeof data !== 'object') throw Error('Invalid request');
    if(url.pathname === '/api/auth/challenge') return reply(res,200,auth.challenge(data.address));
    if(url.pathname === '/api/auth/confirm') {
      const token=auth.confirm(data.address,data.nonce,data.signature);
      res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
      return reply(res,200,{authenticated:true});
    }
    const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);
    const owner=token ? auth.owner(token) : 'demo.synthetic';
    let result;
    if(url.pathname === '/api/jobs') result=await demo.create(owner,data.jobId,data.budget,data.limit);
    if(url.pathname === '/api/payments') result=await demo.pay(owner,data.jobId,data.invoiceId,data.amount);
    if(url.pathname === '/api/recover') result=await demo.fail(owner,data.jobId);
    return reply(res,200,{job:result,environment:isNear?'local-near-synthetic':'synthetic'});
  } catch(e) { return reply(res,400,{error:e.message}); }
});
server.listen(port,'127.0.0.1',()=>console.log('Synthetic demo at http://127.0.0.1:'+port));

