// Disposable browser test. Meteor pages are intercepted fixtures; no wallet or blockchain is contacted.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const module=await readFile(new URL('../site/near-wallet.mjs',import.meta.url),'utf8');
const server=createServer((req,res)=>{
 res.setHeader('Content-Type',req.url==='/near-wallet.mjs'?'text/javascript':'text/html');
 res.end(req.url==='/near-wallet.mjs'?module:`<!doctype html><title>Synthetic NEAR wallet handoff test</title><button id="run">Review synthetic request</button><output id="result"></output><script type="module">
 import {meteorRequest} from '/near-wallet.mjs';
 window.mode='success';
 document.querySelector('#run').onclick=async()=>{const popup=window.open('about:blank','SyntheticWallet','popup,width=480,height=720');
 try{window.result=await meteorRequest('sign',{transactions:'SYNTHETIC-NO-FUNDS',mode:window.mode},popup,{timeout:6000});}
 catch(e){window.result={error:e.message};}finally{popup?.close();document.querySelector('#result').textContent=JSON.stringify(window.result);}};
 </script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'swarm-wallet-smoke-'));
const chrome=spawn(process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
 '--headless=new','--remote-debugging-pipe','--user-data-dir='+profile,'--disable-extensions','--disable-sync','--disable-background-networking','--disable-popup-blocking','--no-first-run','about:blank'
],{stdio:['ignore','ignore','ignore','pipe','pipe']});
let tail='',id=0,session;const pending=new Map(),errors=[],walletRequests=[];
const cdp=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});chrome.stdio[3].write(JSON.stringify({id:n,method,params,sessionId:sid||undefined})+'\0');});
async function event(message){
 if(message.method==='Target.attachedToTarget'&&message.params.targetInfo.type==='page'){
  const sid=message.params.sessionId;
  await cdp('Fetch.enable',{patterns:[{urlPattern:'https://wallet.meteorwallet.app/*'}]},sid);
  await cdp('Runtime.runIfWaitingForDebugger',{},sid);
 }
 if(message.method==='Fetch.requestPaused'){
  const {request,requestId}=message.params;if(new URL(request.url).pathname.startsWith('/connect/'))walletRequests.push(request.url);
  const html=`<!doctype html><title>DISPOSABLE SYNTHETIC METEOR FIXTURE</title><p>Synthetic approval only</p><script>
  let processed=false;window.addEventListener('message',event=>{const d=event.data;if(!d?.inputs||processed)return;processed=true;
   window.opener.postMessage({uid:d.uid,status:'connected'},event.origin);
   if(d.inputs.mode==='lost'){setTimeout(()=>window.close(),100);return;}
   setTimeout(()=>window.opener.postMessage({uid:d.uid,status:d.inputs.mode==='rejected'?'closed_fail':'closed_success',payload:{executionOutcomes:[{transaction:{hash:'11111111111111111111111111111111'}}]}},event.origin),100);
  });</script>`;
  await cdp('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from(html).toString('base64')},message.sessionId);
 }
}
chrome.stdio[4].on('data',bytes=>{tail+=bytes.toString();let n;while((n=tail.indexOf('\0'))!==-1){const m=JSON.parse(tail.slice(0,n));tail=tail.slice(n+1);const r=pending.get(m.id);if(r){pending.delete(m.id);m.error?r.reject(Error(m.error.message)):r.resolve(m.result);}else event(m).catch(e=>errors.push(e.message));}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
const timer=setTimeout(()=>chrome.kill('SIGTERM'),40000);
try{
 const {targetInfos}=await cdp('Target.getTargets');
 ({sessionId:session}=await cdp('Target.attachToTarget',{targetId:targetInfos.find(t=>t.type==='page').targetId,flatten:true}));
 await cdp('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},null);
 await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
 for(let i=0;i<60;i++){if(await evaluate('!!document.querySelector("#run")?.onclick'))break;await pause(100);}
 for(const mode of ['success','lost','rejected']){
  await evaluate('window.result=null;window.mode='+JSON.stringify(mode)+';document.querySelector("#run").click()');
  let result;for(let i=0;i<100;i++){result=await evaluate('window.result');if(result)break;await pause(100);}
  assert.ok(result,mode+' must finish');
  if(mode==='success')assert.equal(result.executionOutcomes?.[0]?.transaction.hash,'11111111111111111111111111111111',JSON.stringify({result,walletRequests,errors}));
  else assert.match(result.error,/Resume the same job/);
 }
 assert.equal(walletRequests.length,3);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,cases:['popup success','lost response/window close','wallet rejection'],walletPages:'intercepted synthetic fixtures',externalWalletOrChainCalls:0}));
}finally{clearTimeout(timer);chrome.kill('SIGTERM');await new Promise(r=>chrome.exitCode!==null||chrome.signalCode?r():chrome.once('exit',r));await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:3});}
