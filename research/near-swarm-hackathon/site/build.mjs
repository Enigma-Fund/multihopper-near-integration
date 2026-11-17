// Build an isolated Pages Function using only local release sources and Node built-ins.
import {readFile,writeFile} from 'node:fs/promises';
const read=name=>readFile(new URL(name,import.meta.url),'utf8');
const html=(await read('index.html')).replace('<!--BLOCKS-->','<i></i>'.repeat(56));
const orders=await read('orders.mjs');
const receipt=await read('receipt.mjs');
const assets={'/receipt.mjs':['text/javascript; charset=utf-8',receipt.replace("'./orders.mjs'","'/near-swarm/orders.mjs'")],'/':['text/html; charset=utf-8',html],'/browser.mjs':['text/javascript; charset=utf-8',(await read('browser.mjs')).replace("'./orders.mjs'","'/near-swarm/orders.mjs'")],'/orders.mjs':['text/javascript; charset=utf-8',orders.split('export async function order(')[0]]};
const sources=[orders,await read('receipt.mjs'),await read('worker.mjs')].map(s=>s.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
if(!process.argv[2])throw Error('Output path required');
await writeFile(process.argv[2],sources+'\nconst pagesAssets='+JSON.stringify(assets)+';\nexport default {fetch(request,env){return serve(request,env,pagesAssets);}};\n');
