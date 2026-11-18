// Build an isolated Pages Function using only local release sources and Node built-ins.
import {readFile,writeFile} from 'node:fs/promises';
const read=name=>readFile(new URL(name,import.meta.url),'utf8');
const html=(await read('index.html')).replace('<!--BLOCKS-->','<i></i>'.repeat(56));
const orders=await read('orders.mjs');
const receipt=await read('receipt.mjs');
const assets={'/receipt.mjs':['text/javascript; charset=utf-8',receipt.replace("'./orders.mjs'","'/near-swarm/orders.mjs'")],'/':['text/html; charset=utf-8',html],'/browser.mjs':['text/javascript; charset=utf-8',(await read('browser.mjs')).replace("'./orders.mjs'","'/near-swarm/orders.mjs'")],'/orders.mjs':['text/javascript; charset=utf-8',orders.split('export async function verifyOrderSignature(')[0]]};
assets['/near-wallet.mjs']=['text/javascript; charset=utf-8',await read('near-wallet.mjs')];
assets['/payment-runner.mjs']=['text/javascript; charset=utf-8',await read('payment-runner.mjs')];
assets['/resume-state.mjs']=['text/javascript; charset=utf-8',await read('resume-state.mjs')];
assets['/authorization-cache.mjs']=['text/javascript; charset=utf-8',await read('authorization-cache.mjs')];
assets['/batch-payment.mjs']=['text/javascript; charset=utf-8',await read('batch-payment.mjs')];
assets['/local-demo-wallet.mjs']=['text/javascript; charset=utf-8',(await read('local-demo-wallet.mjs')).replace("'./orders.mjs'","'/near-swarm/orders.mjs'")];
const apiDocs=(await read('../API.md')).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
assets['/api/docs']=['text/html; charset=utf-8','<!doctype html><meta name=viewport content=width=device-width><title>Swarm API reference</title><style>body{max-width:960px;margin:40px auto;padding:20px;font:16px system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>'+apiDocs+'</pre>'];
const near=await read('near-job.mjs');
assets['/near-job.mjs']=['text/javascript; charset=utf-8',near.replace("'./orders.mjs'","'/near-swarm/orders.mjs'")];
const sources=[orders,near,await read('near-contract.mjs'),receipt,await read('settlement-evidence.mjs'),await read('settlement-client.mjs'),await read('wallet-bundle.mjs'),await read('settlement.mjs'),await read('notifications.mjs'),await read('durable.mjs'),await read('reconcile-trigger.mjs'),await read('shared-receipt.mjs'),await read('worker.mjs')].map(s=>s.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
if(!process.argv[2])throw Error('Output path required');
const entry=process.argv[3]==='reconciler'
 ? 'export default {scheduled(event,env,ctx){ctx.waitUntil(reconcilePending(env.SWARM_JOBS,settlementServices(env)));},fetch(){return new Response("Not found",{status:404});}};'
 : 'export default {fetch(request,env){return serve(request,env,pagesAssets);}};';
await writeFile(process.argv[2],sources+'\nconst pagesAssets='+JSON.stringify(assets)+';\n'+entry+'\n');
