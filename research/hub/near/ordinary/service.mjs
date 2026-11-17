import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {GrantProvider} from './provider.mjs';
const config=JSON.parse(readFileSync(process.argv[2]));
const provider=new GrantProvider(config);
console.log(JSON.stringify({ready:true}));
try {for await(const line of createInterface({input:process.stdin})){
 let id=null;try{if(line.length>4096)throw Error('request too large');const message=JSON.parse(line);id=message.id;const result=await provider.request(message.request);console.log(JSON.stringify({id,result}));}
 catch(e){const message=String(e.message);console.log(JSON.stringify({id,error:message.includes('signed_tx')||message.length>400?'provider request failed; state retained; error fields: '+[...new Set([...message.matchAll(/"([A-Za-z_]{1,50})"\s*:/g)].map(x=>x[1]))].slice(0,25).join(','):message}));}
}} finally {provider.close();}
