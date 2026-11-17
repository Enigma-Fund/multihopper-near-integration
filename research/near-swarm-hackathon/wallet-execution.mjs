import {createHash} from 'node:crypto';
// Client orchestration only. The inspector and RPC adapter must be independently
// implemented and verified. No validator, signer, or network fallback is provided.
function items(b){
 if(!b||!Array.isArray(b.routeInitTxs)||!Array.isArray(b.sessionInitTxs)||!Array.isArray(b.dispersionInitTxs)||typeof b.recentBlockhash!=='string'||!Number.isSafeInteger(b.lastValidBlockHeight)||b.lastValidBlockHeight<1)throw Error('Invalid prepared bundle');
 const v=[...(b.keeperFundingTx?[['keeper',b.keeperFundingTx]]:[]),...b.routeInitTxs.map(x=>['route',x?.base64]),...(b.orchestratorInitTx?[['orchestrator',b.orchestratorInitTx]]:[]),...b.sessionInitTxs.map(x=>['session',x]),...b.dispersionInitTxs.map(x=>['dispersion',x])];
 if(v.length>100||v.some(([,x])=>typeof x!=='string'||x.length<4||x.length>40000||!/^[A-Za-z0-9+/]+={0,2}$/.test(x)))throw Error('Invalid transaction encoding');
 const seen=new Set();for(const [,x] of v){if(seen.has(x))throw Error('Duplicate prepared transaction');seen.add(x);}return v;
}
export async function executeWalletBundle({bundle,owner,expected,inspector,wallet,rpc,journal,operationId}){
 if(!owner||!expected||!inspector||typeof inspector.inspect!=='function'||!wallet||typeof wallet.signAndSend!=='function'||!rpc||typeof rpc.confirm!=='function'||!journal||typeof journal.run!=='function'||typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,40}$/.test(operationId))throw Error('Verified wallet execution dependencies required');
 const transactions=items(bundle),checked=[];
 // Validate every transaction before asking the wallet to sign any of them.
 for(let i=0;i<transactions.length;i++){const [kind,encoded]=transactions[i];const result=await inspector.inspect({kind,encoded,owner,expected,recentBlockhash:bundle.recentBlockhash});if(!result||result.valid!==true||result.owner!==owner||result.recentBlockhash!==bundle.recentBlockhash)throw Error('Transaction inspection failed');checked.push({kind,encoded});}
 const signatures=[];
 for(let i=0;i<checked.length;i++){
  const {kind,encoded}=checked[i],hash=createHash('sha256').update(encoded).digest('hex'),key=`${operationId}_${i}`;
  const sent=await journal.run({key,owner,method:'WALLET_SEND',path:`/${kind}/${hash}`,body:{recentBlockhash:bundle.recentBlockhash,lastValidBlockHeight:bundle.lastValidBlockHeight}},async()=>{const signature=await wallet.signAndSend({kind,encoded});if(typeof signature!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature))throw Error('Invalid wallet response');return {signature};});
  const confirmation=await rpc.confirm({signature:sent.signature,blockhash:bundle.recentBlockhash,lastValidBlockHeight:bundle.lastValidBlockHeight});if(!confirmation||confirmation.final!==true||confirmation.error!=null)throw Error('Transaction confirmation unresolved or failed');signatures.push({kind,signature:sent.signature});
 }
 return signatures;
}
