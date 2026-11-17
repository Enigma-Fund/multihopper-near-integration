// Loopback-only, human-operated approval connection for the pre-funded demo accounts.
// No signing/broadcast on startup, GET, preparation, or status polling.
import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes,createPublicKey,verify} from 'node:crypto';
import {inspectNear,deploymentWire,sha,base58} from './near-wire.mjs';
import {inspectWire} from '../site/wallet-bundle.mjs';
import {fromBase58} from '../site/orders.mjs';
import {nearDigest} from '../site/near-job.mjs';
import {approvalJournal} from './approval-journal.mjs';
import {checkWorkOrderMessage} from './message-policy.mjs';
import {inspectSolanaBatch,packSolanaBatch} from './solana-batch.mjs';

const local='http://127.0.0.1:18871';
const allowed=new Set(['https://multihopper-swarm-for-hire.pages.dev','https://business.multihopper.com',local]);
const config=JSON.parse(await readFile(new URL('./wallet.local.json',import.meta.url)));
const journal=new URL('./build/approval-journal/',import.meta.url);
await mkdir(journal,{recursive:true,mode:0o700});
const requests=new Map();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function rpc(network,method,params){
  const url=network==='near'?'https://rpc.mainnet.near.org':'https://api.mainnet.solana.com';
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Chain connection unavailable ('+r.status+')');const body=await r.json();
  if(body.error)throw Error('Chain request failed: '+(body.error.message||body.error.name||'unknown'));
  return body.result;
}
async function nearAccess(identity){
  const [network,access]=await Promise.all([rpc('near','status',[]),rpc('near','query',{request_type:'view_access_key',account_id:identity.accountId,public_key:identity.publicKey,finality:'final'})]);
  if(network.chain_id!=='mainnet')throw Error('Wrong NEAR network');return access;
}
async function prepareDeployment(){
  const a=await rpc('near','query',{request_type:'view_account',account_id:config.contract.accountId,finality:'final'});
  const expected=base58(Buffer.from(config.wasmSha256,'hex'));
  if(a.code_hash===expected){
    const result=await rpc('near','query',{request_type:'call_function',account_id:config.contract.accountId,method_name:'configuration',args_base64:'e30=',finality:'final'});
    const c=JSON.parse(Buffer.from(result.result).toString());
    if(c.publisher!==config.publisher||c.network!=='mainnet')throw Error('Existing contract configuration differs');
    return {deployed:true,account:config.contract.accountId,codeHash:expected,configuration:c};
  }
  if(a.code_hash!=='11111111111111111111111111111111')throw Error('Refusing to overwrite existing code');
  const key=await nearAccess(config.contract);if(key.permission!=='FullAccess')throw Error('Full-access key required');
  const wasm=await readFile(new URL('../contract/target/wasm32-unknown-unknown/release/multihopper_swarm_jobs.wasm',import.meta.url));
  if(sha(wasm).toString('hex')!==config.wasmSha256)throw Error('Build hash changed');
  if(BigInt(a.amount)<BigInt(wasm.length+10000)*10000000000000000000n)throw Error('Insufficient deployment storage margin');
  return {kind:'near-sign',inputs:{transactions:deploymentWire({account:config.contract.accountId,publicKey:config.contract.publicKey,nonce:BigInt(key.nonce)+1n,blockHash:key.block_hash,wasm,publisher:config.publisher}).toString('base64')}};
}
async function validate(request){
  const {kind,inputs,origin}=request;if(!allowed.has(origin))throw Error('Unapproved website');
  if(kind==='near-sign'){
    const tx=inspectNear(inputs.transactions,config),identity=tx.deploy?config.contract:config.operator;
    const [access,block,protocol,state]=await Promise.all([nearAccess(identity),rpc('near','block',{block_id:tx.blockHash}),
      rpc('near','EXPERIMENTAL_protocol_config',{finality:'final'}),rpc('near','query',{request_type:'view_account',account_id:config.contract.accountId,finality:'final'})]);
    if(access.permission!=='FullAccess'||tx.nonce<=BigInt(access.nonce))throw Error('NEAR nonce was already consumed; check the saved transaction');
    if(!Number.isSafeInteger(protocol.transaction_validity_period)||access.block_height-block.header.height>=protocol.transaction_validity_period||block.header.height>access.block_height)throw Error('NEAR signing request expired; re-open the same operation');
    if(state.code_hash!==(tx.deploy?'11111111111111111111111111111111':base58(Buffer.from(config.wasmSha256,'hex'))))throw Error('Unexpected contract code');
    const review=['NEAR MAINNET',tx.deploy?'Deploy and initialize dedicated Swarm for Hire contract':'Approve NEAR job operation',
      'Account: '+tx.signer,'Contract: '+tx.receiver,...tx.actions.map(a=>a.kind==='deploy'?'Code SHA-256: '+a.hash+'\nStorage allocation: approximately 2.54 NEAR':a.method+'\nDeposit: '+a.deposit+' yoctoNEAR\nArguments: '+JSON.stringify(a.args)),
      'Transaction: '+tx.hash].join('\n\n');
    return {tx,role:tx.role,bytes:sha(tx.bytes),publicKeyHex:tx.publicBytes.toString('hex'),review};
  }
  if(kind==='solana-message'){
    const message=Buffer.from(inputs.message,'base64');const text=message.toString('utf8');
    checkWorkOrderMessage(text,origin,config.solana);
    return {role:'solana',bytes:message,publicKeyHex:Buffer.from(fromBase58(config.solana,32)).toString('hex'),review:'Sign a Solana work-order message (no network transaction).\n\n'+text};
  }
  if(kind==='near-sign-message'){
    const {message,nonce,recipient,accountId}=inputs;
    if(accountId!==config.operator.accountId||recipient!==new URL(origin).host||!message.startsWith('["multihopper-swarm-link-v1",')||!message.includes(JSON.stringify(origin))||!Array.isArray(nonce)||nonce.length!==32||nonce.some(x=>!Number.isInteger(x)||x<0||x>255))throw Error('Invalid NEAR work-order link');
    return {role:'near-operator',bytes:Buffer.from(await nearDigest(message,Uint8Array.from(nonce),recipient)),
      publicKeyHex:config.operator.accountId,review:'Sign a NEAR work-order link (no network transaction).\n\n'+message};
  }
  if(kind==='solana-transaction'){
    const tx=inspectWire(inputs.transaction,config.solana);
    if((await rpc('solana','getGenesisHash',[]))!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Wrong Solana network');
    const sim=await rpc('solana','simulateTransaction',[inputs.transaction,{encoding:'base64',sigVerify:false,commitment:'confirmed',accounts:{encoding:'base64',addresses:[config.solana]}}]);
    if(sim.value.err)throw Error('Solana simulation rejected this operation: '+JSON.stringify(sim.value.err));
    const balance=(await rpc('solana','getBalance',[config.solana,{commitment:'confirmed'}])).value;
    const after=sim.value.accounts?.[0]?.lamports;if(!Number.isSafeInteger(after))throw Error('Simulation did not return the payer balance');
    const debit=Math.max(0,balance-after);if(debit>100000000||after<650240)throw Error('Demo budget/provider reserve would be exceeded');
    return {tx,role:'solana',bytes:Buffer.from(tx.wire.slice(tx.start)),publicKeyHex:Buffer.from(tx.keys[0]).toString('hex'),
      review:'SOLANA MAINNET\n\nApprove one prepared MultiHopper transaction.\nAccount: '+config.solana+'\nSimulated debit: '+(debit/1e9)+' SOL\nMessage SHA-256: '+sha(tx.wire.slice(tx.start)).toString('hex')+'\nPrograms: '+tx.programs.join(', ')};
  }
  if(kind==='solana-batch'){
    const transactions=inspectSolanaBatch(inputs.transactions,config.solana);
    if((await rpc('solana','getGenesisHash',[]))!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Wrong Solana network');
    for(const hash of new Set(transactions.map(tx=>tx.blockhash)))if((await rpc('solana','isBlockhashValid',[hash,{commitment:'confirmed'}])).value!==true)throw Error('Batch expired before signing. Resume the same invoice.');
    const sim=await rpc('solana','simulateTransaction',[inputs.transactions[0],{encoding:'base64',sigVerify:false,commitment:'confirmed',accounts:{encoding:'base64',addresses:[config.solana]}}]);
    if(sim.value.err)throw Error('First remaining transaction failed simulation: '+JSON.stringify(sim.value.err));
    const balance=(await rpc('solana','getBalance',[config.solana,{commitment:'confirmed'}])).value,after=sim.value.accounts?.[0]?.lamports;
    if(!Number.isSafeInteger(after)||balance-after>100000000||after<650240)throw Error('Demo budget/provider reserve would be exceeded');
    return {transactions,role:'solana',batch:transactions.map(tx=>Buffer.from(tx.wire.slice(tx.start))),publicKeyHex:Buffer.from(transactions[0].keys[0]).toString('hex'),
      review:'SOLANA MAINNET\n\nApprove '+transactions.length+' remaining MultiHopper transactions together.\nAccount: '+config.solana+'\nFirst step simulated debit: '+(Math.max(balance-after,0)/1e9)+' SOL\n\nThe website stores the signed batch, then simulates and submits each step in order under the signed invoice cost limit. Later dependent steps are checked after earlier steps confirm.\n\n'+transactions.map((tx,i)=>(i+1)+'. '+tx.programs.join(', ')+'\nMessage: '+sha(tx.wire.slice(tx.start)).toString('hex')).join('\n\n')};
  }
  throw Error('Unsupported request');
}
async function save(key,row){const file=new URL(key+'.json',journal),tmp=new URL(key+'.tmp',journal);await writeFile(tmp,JSON.stringify(row),{mode:0o600});await rename(tmp,file);}
async function load(key){try{return JSON.parse(await readFile(new URL(key+'.json',journal)));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function nativeApprove(v){return new Promise((resolve,reject)=>{
  const child=spawn(fileURLToPath(new URL('./build/approve-demo',import.meta.url)),[],{stdio:['pipe','pipe','pipe']});let out='',err='';
  child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});child.on('error',reject);
  child.on('close',code=>{if(code!==0){const error=Error(err.trim()||'Signature declined');error.retryable=code===2;return reject(error);}if(v.batch){try{const signatures=JSON.parse(out.trim()).map(s=>Buffer.from(s,'base64'));packSolanaBatch(v.transactions,signatures);return resolve(signatures);}catch{return reject(Error('Native batch signature verification failed'));}}const sig=Buffer.from(out.trim(),'base64');
    const pub=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(v.publicKeyHex,'hex')]),format:'der',type:'spki'});
    if(sig.length!==64||!verify(null,v.bytes,pub,sig))return reject(Error('Signature verification failed'));resolve(sig);});
  child.stdin.end(JSON.stringify({role:v.role,...(v.batch?{batch:v.batch.map(bytes=>bytes.toString('base64'))}:{bytes:v.bytes.toString('base64')}),review:v.review,publicKeyHex:v.publicKeyHex}));
});}
async function resolveSigned(row){
  if(row.kind!=='near-sign')return row.result;
  // Read-only reconciliation. No automatic broadcast or replacement transaction.
  const out=await rpc('near','tx',{tx_hash:row.hash,sender_account_id:row.signer,wait_until:'FINAL'});
  if(out.final_execution_status!=='FINAL'||!Object.hasOwn(out.status??{},'SuccessValue')||out.receipts_outcome?.some(r=>r.outcome.status?.Failure))throw Error('NEAR operation is not a finalized success');
  row.result={executionOutcomes:[out]};row.status='finalized';await save(row.key,row);return row.result;
}
const performApproval=approvalJournal({load,save,prepare:validate,sign:nativeApprove,
  broadcast:row=>rpc('near','send_tx',{signed_tx_base64:row.signed,wait_until:'EXECUTED'}),resolve:resolveSigned,
  async pack(key,request,v,sig){
    if(request.kind==='near-sign'){
      return {key,kind:request.kind,hash:v.tx.hash,signer:v.tx.signer,signed:Buffer.concat([v.tx.bytes,Buffer.from([0]),sig]).toString('base64'),status:'signed',createdAt:new Date().toISOString()};
    }
    let result;
    if(request.kind==='solana-batch')result={signedTransactions:packSolanaBatch(v.transactions,sig)};
    else if(request.kind==='solana-transaction'){const wire=Buffer.from(v.tx.wire);sig.copy(wire,1);result={signedTransaction:wire.toString('base64')};}
    else if(request.kind==='near-sign-message')result={signature:sig.toString('base64'),accountId:config.operator.accountId,publicKey:config.operator.publicKey};
    else result={signature:sig.toString('base64')};
    return {key,kind:request.kind,result,status:'signed',createdAt:new Date().toISOString()};
  }
});
async function approve(request){
  return performApproval(sha(Buffer.from(JSON.stringify([request.kind,request.inputs]))).toString('hex'),request);
}
async function body(req){let text='';for await(const b of req){text+=b;if(text.length>750000)throw Error('Request too large');}return JSON.parse(text);}
const page=await readFile(new URL('./demo-wallet.html',import.meta.url));
const script=await readFile(new URL('./demo-wallet-browser.mjs',import.meta.url));
http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!=='127.0.0.1:18871')return json(res,403,{error:'Local host required'});
    const url=new URL(req.url,local);
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});return res.end(page);}
    if(req.method==='GET'&&url.pathname==='/wallet.mjs'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});return res.end(script);}
    if(req.method==='GET'&&url.pathname==='/info')return json(res,200,{solana:config.solana,near:config.operator.accountId,publicKey:config.operator.publicKey,contract:config.contract.accountId});
    if(req.method!=='POST'||req.headers.origin!==local||req.headers['content-type']!=='application/json')return json(res,403,{error:'Use the local approval window'});
    if(url.pathname==='/prepare-deployment'){
      const data=await prepareDeployment();if(data.deployed)return json(res,200,data);
      const id=randomBytes(24).toString('hex'),request={...data,origin:local};requests.set(id,{request,at:Date.now()});
      const v=await validate(request);return json(res,200,{id,review:v.review});
    }
    const data=await body(req);
    if(url.pathname==='/request'){
      const request={kind:data.kind,inputs:data.inputs,origin:data.origin},v=await validate(request),id=randomBytes(24).toString('hex');
      requests.set(id,{request,at:Date.now()});return json(res,200,{id,review:v.review});
    }
    const entry=requests.get(data.id);if(!entry||Date.now()-entry.at>(entry.request.origin===local?86400000:240000))throw Error('Approval expired. Re-open the same operation.');
    if(url.pathname==='/approve')return json(res,200,{result:await approve(entry.request)});
    if(url.pathname==='/status'){
      const key=sha(Buffer.from(JSON.stringify([entry.request.kind,entry.request.inputs]))).toString('hex'),row=await load(key);
      if(!row)throw Error('No signature recorded for this request');return json(res,200,{result:await resolveSigned(row)});
    }
    return json(res,404,{error:'Not found'});
  }catch(e){json(res,400,{error:e.message,retryable:e.retryable===true,notSigned:e.notSigned===true});}
}).listen(18871,'127.0.0.1',()=>console.log('Approval window ready: '+local+' (no transaction signed or broadcast)'));
