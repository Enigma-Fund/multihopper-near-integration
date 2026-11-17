// Complete block/chunk history for this disposable local chain, before evaluation selection.
export async function capture(rpc,startHeight){
 await rpc.verify();const tip=await rpc.rpc('status',[]);
 async function read(method,params){if(!['block','chunk','tx'].includes(method))throw Error('read-only capture');const r=await fetch(rpc.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'capture',method,params}),signal:AbortSignal.timeout(30000)});const data=await r.json();if(data.error)throw Error('public capture failed '+method+' '+JSON.stringify(params)+' '+(data.error.cause?.name||data.error.name));return data.result;}
 const blocks=[];let cursor=await read('block',{finality:'final'});const end=cursor.header.height;
 while(cursor.header.height>=startHeight){blocks.push(cursor);if(cursor.header.height<=startHeight)break;cursor=await read('block',{block_id:cursor.header.prev_hash});}
 const txs=[],transfers=[],seen=new Set();
 for(const block of blocks.reverse()){const h=block.header.height;
  for(const chunk of block.chunks){if(chunk.height_included!==h)continue;const data=await read('chunk',{chunk_id:chunk.chunk_hash});for(const tx of data.transactions){if(seen.has(tx.hash))continue;seen.add(tx.hash);
   // Preserve every public action, signer, receiver, nonce and key; omit reusable signature payloads.
   txs.push({height:h,hash:tx.hash,signer_id:tx.signer_id,receiver_id:tx.receiver_id,nonce:tx.nonce,public_key:tx.public_key,actions:tx.actions.map(a=>a.DeployContract?{DeployContract:{code:'[public WASM omitted; code hashes retained in summary]'}}:a.FunctionCall?{...a,decodedArgs:JSON.parse(Buffer.from(a.FunctionCall.args,'base64'))}:a)});
   for(const action of tx.actions){const f=action.FunctionCall;if(f?.method_name!=='ft_transfer')continue;
    const result=await read('tx',{tx_hash:tx.hash,sender_account_id:tx.signer_id,wait_until:'FINAL'});if(result.final_execution_status!=='FINAL')throw Error('capture not final');if(result.status.Failure)continue;
    const args=JSON.parse(Buffer.from(f.args,'base64'));transfers.push({height:h,transaction:tx.hash,token:tx.receiver_id,from:tx.signer_id,to:args.receiver_id,amount:args.amount,memo:args.memo??null});
   }
  }}
 }
 return {scope:'All blocks/chunks and successful ft_transfer actions in recorded local run interval; not a remote cold-start investigation',startHeight,endHeight:end,transactions:txs,transfers};
}
