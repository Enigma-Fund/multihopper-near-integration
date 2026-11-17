import {fromBase58} from './orders.mjs';
import {messageHash} from './settlement-evidence.mjs';
import {hashHex} from './near-job.mjs';
import {ServiceUnavailable} from './settlement-client.mjs';

const permittedPrograms=new Set([
  '11111111111111111111111111111111','ComputeBudget111111111111111111111111111111','AddressLookupTab1e1111111111111111111111111',
  'Ed25519SigVerify111111111111111111111111111','ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  '3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh','4TPCmR2uN3hDM1FbTsf7ZtFXwXGSz4u1Kxv5YHj6eruX','2JEv3pD6nczEvn1xDXaEzehkJofPPjoQQpnW5nGY3r52'
]);
function encode58(bytes){
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let v=0n,s='';for(const b of bytes)v=v*256n+BigInt(b);
  while(v){s=alphabet[Number(v%58n)]+s;v/=58n;}
  for(const b of bytes){if(b)break;s='1'+s;}return s;
}
export function inspectWire(encoded,owner){
  const wire=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)), count=wire[0];
  if(wire.length>1232||!count||count>19)throw Error('Invalid wallet transaction');
  const start=1+64*count;let p=start;
  function take(n){if(!Number.isSafeInteger(n)||n<0||p+n>wire.length)throw Error('Truncated wallet transaction');const b=wire.slice(p,p+n);p+=n;return b;}
  function length(){const b=take(1)[0];if(b<128)return b;const c=take(1)[0];if(c<1||c>=128)throw Error('Invalid compact length');return (b&127)+128*c;}
  const versioned=wire[p]===128;if(versioned)p++;
  const header=take(3);if(header[0]!==count||header[1]>=count)throw Error('Unexpected signer header');
  const keys=Array.from({length:length()},()=>take(32));if(count>keys.length||keys.length>256||encode58(keys[0])!==owner)throw Error('Wallet is not the transaction fee payer');
  const blockOffset=p,blockhash=encode58(take(32));const programs=[];
  for(let i=length();i>0;i--){const index=take(1)[0];const program=keys[index]&&encode58(keys[index]);if(!permittedPrograms.has(program))throw Error('Unsupported instruction in the payment bundle');
    const accounts=take(length()),data=take(length());programs.push(program);
    if(program==='11111111111111111111111111111111'){
      const op=data.length>=4?new DataView(data.buffer,data.byteOffset).getUint32(0,true):-1;
      if(![0,2].includes(op)||accounts.length!==2)throw Error('Unsupported system instruction');
    }
  }
  if(versioned){for(let i=length();i>0;i--){take(32);take(length());take(length());}}
  if(!programs.length||p!==wire.length)throw Error('Invalid transaction instructions');
  return {wire,count,start,keys,blockOffset,blockhash,signature:encode58(wire.slice(1,65)),programs};
}
export function bundleItems(b,recovery){
  let items;
  if(recovery)items=(b?.rescueTxs??[]).map(x=>({kind:'rescue',bytes:x.base64}));
  else{
    if(!Array.isArray(b?.routeInitTxs)||!Array.isArray(b?.sessionInitTxs)||!Array.isArray(b?.dispersionInitTxs))throw Error('Unexpected API payment bundle');
    items=[...(b.keeperFundingTx?[{kind:'keeper',bytes:b.keeperFundingTx}]:[]),...b.routeInitTxs.map(x=>({kind:'route',bytes:x.base64})),...(b.orchestratorInitTx?[{kind:'orchestrator',bytes:b.orchestratorInitTx}]:[]),...b.sessionInitTxs.map(bytes=>({kind:'session',bytes})),...b.dispersionInitTxs.map(bytes=>({kind:'dispersion',bytes}))];
  }
  if(!items.length||items.length>(recovery?12:100)||items.some(x=>typeof x.bytes!=='string'||x.bytes.length>1650))throw Error('Invalid or empty prepared bundle');
  return items;
}
const packetQuery='SELECT * FROM swarm_wallet_batches WHERE reference=? AND mode=?';
function checkPrepared(result,row,services,job){
  const t=result?.transfer;
  if(!t||String(t.id)!==row.transfer_id||t.externalId!==row.external_id||t.sourceOwner!==row.owner||t.tokenMint!=='So11111111111111111111111111111111111111112'||t.isTest!==services.expectedTest||String(t.amountRaw)!==row.amount||String(t.recipientReceivesRaw)!==row.quoted_net||t.destinationCount!==1)throw Error('Prepared payment differs from the signed invoice');
  if(t.recipientWallet!=null&&t.recipientWallet!==job.recipient||t.destinations!=null&&(t.destinations.length!==1||t.destinations[0].wallet!==job.recipient||String(t.destinations[0].amountRaw)!==row.quoted_net))throw Error('Prepared payout destination changed');
}
async function checkedSignature(bytes,item,owner){
  const tx=inspectWire(bytes||'',owner);
  if(await messageHash(bytes)!==item.digest)throw Error('Wallet returned a different transaction');
  for(let i=0;i<tx.count;i++){
    const key=await crypto.subtle.importKey('raw',tx.keys[i],'Ed25519',false,['verify']);
    if(!await crypto.subtle.verify('Ed25519',key,tx.wire.slice(1+i*64,65+i*64),tx.wire.slice(tx.start)))throw Error('Incomplete wallet signatures');
  }
  return tx;
}
export async function walletBatch(db,services,row,body,job){
  const mode=body.mode, rescue=mode==='recovery', load=()=>db.prepare(packetQuery).bind(row.external_id,mode).first();
  let batch=await load();
  if(!batch){
    if(body.action!=='prepare-wallet')throw Error('Prepare this invoice in your wallet first');
    if(!rescue && job.state!=='open')throw Error('This work order is closed');
    if(rescue && !body.canRescue)throw Error('The route has no recoverable funds');
    const id=await hashHex('swarm-wallet:'+row.external_id+':'+mode);
    const result=rescue?await services.prepareRefund(row.transfer_id,id):await services.preparePayment(row.transfer_id,id);
    if(!rescue){
      const t=result?.transfer;
      if(!t||String(t.id)!==row.transfer_id||t.externalId!==row.external_id||t.sourceOwner!==row.owner||t.tokenMint!=='So11111111111111111111111111111111111111112'||t.isTest!==services.expectedTest||String(t.amountRaw)!==row.amount||String(t.recipientReceivesRaw)!==row.quoted_net||t.destinationCount!==1)throw Error('Prepared payment differs from the signed invoice');
    }
    const items=bundleItems(rescue?result:result.preparedTxs,rescue);
    const born=services.finalizedSlot?await services.finalizedSlot():null;
    for(const item of items){inspectWire(item.bytes,row.owner);item.digest=await messageHash(item.bytes);item.born=born;}
    if(new Set(items.map(x=>x.digest)).size!==items.length)throw Error('Duplicate transaction in the API response');
    const statements=[db.prepare(`INSERT INTO swarm_wallet_batches(reference,mode,items,extra) SELECT ?,?,?,? FROM swarm_orders WHERE owner=? AND id=? AND (state='open' OR ?='recovery') ON CONFLICT DO NOTHING`)
      .bind(row.external_id,mode,JSON.stringify(items),body.extra,row.owner,row.id,mode)];
    await db.batch(statements);batch=await load();
    if(!batch)throw Error('Work order closed before payment preparation');
  }
  if(batch.extra!==body.extra)throw Error('Use the network and account cost limit signed for this batch');
  const items=JSON.parse(batch.items),state=JSON.parse(batch.progress||'[]');
  if(body.action==='stage-wallet'){
    if(!rescue&&job.state!=='open')throw Error('Work order closed before signing');
    const supplied=body.signedTransactions;
    const missing=items.map((_,i)=>i).filter(i=>!state[i]);
    if(!Array.isArray(supplied)||supplied.length>12||new Set(supplied.map(s=>s.step)).size!==supplied.length)throw Error('Invalid signed transaction batch');
    const changed=[...state];
    for(const signed of supplied){
      if(!Number.isSafeInteger(signed.step)||!items[signed.step])throw Error('Invalid batch step');
      const tx=await checkedSignature(signed.bytes,items[signed.step],row.owner);
      if(state[signed.step]){if(state[signed.step].signature!==tx.signature)throw Error('An existing signature cannot be replaced');continue;}
      changed[signed.step]={signature:tx.signature,bytes:signed.bytes,debit:null,landed:false};
    }
    if(missing.some(i=>!changed[i]))throw Error('Store the entire remaining signed batch before execution');
    const saved=await db.prepare("UPDATE swarm_wallet_batches SET progress=? WHERE reference=? AND mode=? AND progress=? AND items=? AND done=0 AND EXISTS(SELECT 1 FROM swarm_orders WHERE owner=? AND id=? AND (state='open' OR ?='recovery'))")
      .bind(JSON.stringify(changed),row.external_id,mode,batch.progress,batch.items,row.owner,row.id,mode).run();
    if(!saved.meta.changes)throw Error('Wallet state changed. Resume the same invoice.');
    return {status:'batch-stored'};
  }
  if(body.action==='prepare-wallet'){
    if(!rescue && job.state!=='open')throw Error('The work order is closed');
    const next=items.findIndex((_,i)=>!state[i]?.landed);
    if(body.batchReview&&!batch.done&&next>=0&&items[next].born!=null&&services.blockAvailable){
      const remaining=items.slice(next),availability=await Promise.all(remaining.map(item=>services.blockAvailable(inspectWire(item.bytes,row.owner).blockhash)));
      if(availability.some(valid=>!valid)){
        // /prepare may legitimately generate a new ephemeral mint and rebase an
        // uninitialized route's schedule. Replace the whole unexecuted suffix,
        // only after EVERY old message has expired with complete finalized history.
        if(availability.some(Boolean))throw new ServiceUnavailable('Waiting for all previous unsigned requests to expire. Resume the same invoice.');
        for(const [offset,item] of remaining.entries()){
          const seen=await services.findExpiredMessage(row.owner,item.born,item.digest,inspectWire(item.bytes,row.owner).blockhash);
          if(seen){
            if(offset===0&&state[next]?.signature===seen.signature)return {status:'wallet-review',mode,items:items.map(({kind,bytes},i)=>({kind,bytes,confirmed:!!state[i]?.landed,pending:!!state[i]&&!state[i].landed})),costLimit:batch.extra};
            throw Error('An earlier transaction landed outside the workspace. Reconcile it first.');
          }
        }
        const key=await hashHex('batch-renew:'+row.external_id+':'+mode+':'+remaining.map(x=>x.digest).join(','));
        const result=await (rescue?services.prepareRefund:services.preparePayment)(row.transfer_id,key);
        if(!rescue)checkPrepared(result,row,services,job);
        const fresh=bundleItems(rescue?result:result.preparedTxs,rescue),born=await services.finalizedSlot();
        if(state.slice(0,next).some((s,i)=>s.landed&&items[i].kind==='keeper')&&fresh.some(x=>x.kind==='keeper'))throw Error('The API repeated confirmed keeper funding');
        for(const item of fresh){const tx=inspectWire(item.bytes,row.owner);if(!await services.blockAvailable(tx.blockhash))throw new ServiceUnavailable('The refreshed batch already expired. Resume the same invoice.');item.digest=await messageHash(item.bytes);item.born=born;}
        const changed=[...items.slice(0,next),...fresh];
        if(new Set(changed.map(x=>x.digest)).size!==changed.length)throw Error('The refreshed batch repeated an existing transaction');
        const saved=await db.prepare('UPDATE swarm_wallet_batches SET items=?,progress=? WHERE reference=? AND mode=? AND items=? AND progress=? AND done=0')
          .bind(JSON.stringify(changed),JSON.stringify(state.slice(0,next)),row.external_id,mode,batch.items,batch.progress).run();
        if(!saved.meta.changes)throw Error('Wallet state changed. Resume the same invoice.');
        return {status:'wallet-review',mode,items:changed.map(({kind,bytes},i)=>({kind,bytes,confirmed:!!state[i]?.landed,pending:false})),costLimit:batch.extra};
      }
    }
    if(!body.batchReview&&!batch.done&&next>=0&&items[next].born!=null&&services.blockAvailable){
      const item=items[next],current=inspectWire(item.bytes,row.owner);
      // Keep pending transactions intact until the finalized history covers their entire lifetime.
      // The same authority may sign locally and broadcast from another client.
      if(!await services.blockAvailable(current.blockhash)){
        const seen=await services.findExpiredMessage(row.owner,item.born,item.digest,current.blockhash);
        if(seen){
          if(state[next] && state[next].signature!==seen.signature)throw Error('A different signature was recorded for this step');
          if(!state[next])throw Error('This transaction was signed outside the workspace. Its costs need reconciliation.');
        }else{
          const fresh=await services.latestBlock();
          let bytes;
          if(current.count===1){
            current.wire.fill(0,1,current.start);current.wire.set(fromBase58(fresh.blockhash,32),current.blockOffset);
            bytes=btoa(String.fromCharCode(...current.wire));
          }else{
            const renewed=await (rescue?services.prepareRefund:services.preparePayment)(row.transfer_id,await hashHex('renew:'+row.external_id+':'+mode+':'+item.digest));
            const candidates=bundleItems(rescue?renewed:renewed.preparedTxs,rescue);
            const normalized=tx=>{const msg=tx.wire.slice(tx.start);msg.fill(0,tx.blockOffset-tx.start,tx.blockOffset-tx.start+32);return msg;};
            const expected=await hashHex(normalized(current));
            for(const candidate of candidates.filter(x=>x.kind===item.kind)){
              const tx=inspectWire(candidate.bytes,row.owner);
              if(await hashHex(normalized(tx))===expected&&await services.blockAvailable(tx.blockhash)){bytes=candidate.bytes;break;}
            }
            if(!bytes)throw Error('The API could not renew the same partially signed instructions. This payment needs reconciliation.');
          }
          const changed=[...items],previousState=batch.progress;
          changed[next]={...item,bytes,digest:await messageHash(bytes),born:await services.finalizedSlot()};
          const trimmed=state.slice(0,next);
          const saved=await db.prepare('UPDATE swarm_wallet_batches SET items=?,progress=? WHERE reference=? AND mode=? AND items=? AND progress=? AND done=0')
            .bind(JSON.stringify(changed),JSON.stringify(trimmed),row.external_id,mode,batch.items,previousState).run();
          if(!saved.meta.changes)throw Error('Wallet state changed. Resume the same invoice.');
          items[next]=changed[next];state.splice(next);
        }
      }
    }
    return {status:batch.done?'submitted':'wallet-review',mode,items:items.map(({kind,bytes},i)=>({kind,bytes,confirmed:!!state[i]?.landed,pending:!!state[i]&&!state[i].landed})),costLimit:batch.extra};
  }
  if(batch.done)return {status:'submitted',mode,signatures:state.map(s=>s.signature)};
  const index=state.findIndex(x=>!x.landed),next=index<0?state.length:index;
  if(body.step<next && state[body.step]?.landed)return {status:'step-confirmed',step:body.step,signature:state[body.step].signature};
  if(next<items.length){
    if(body.step!==next)throw Error('Confirm the preceding wallet transaction first');
    const item=items[next],saved=state[next];let pending=saved;
    if(!pending){
      if(!rescue && job.state!=='open')throw Error('Work order closed before signing');
      const tx=await checkedSignature(body.signedTx,item,row.owner);
      const used=state.reduce((n,s)=>n+BigInt(s.debit),0n);
      const debit=await services.simulatedDebit(body.signedTx,row.owner);
      const cap=BigInt(batch.extra)+(rescue?0n:BigInt(row.amount));
      if(used+BigInt(debit)>cap)throw Error('Wallet debit exceeds the approved payment and cost limit');
      pending={signature:tx.signature,bytes:body.signedTx,debit:String(debit),landed:false};
      const changed=await db.prepare(`UPDATE swarm_wallet_batches SET progress=? WHERE reference=? AND mode=? AND progress=? AND items=? AND EXISTS(SELECT 1 FROM swarm_orders WHERE owner=? AND id=? AND (state='open' OR ?='recovery'))`)
        .bind(JSON.stringify([...state,pending]),row.external_id,mode,batch.progress,batch.items,row.owner,row.id,mode).run();
      if(!changed.meta.changes)throw Error('Payment state changed. Resume this invoice.');
    }
    let status=await services.signatureState(pending.signature);
    if(!status&&pending.debit==null){
      const debit=await services.simulatedDebit(pending.bytes,row.owner),used=state.reduce((n,s)=>n+BigInt(s?.debit??0),0n);
      if(used+BigInt(debit)>BigInt(batch.extra)+(rescue?0n:BigInt(row.amount)))throw Error('Wallet debit exceeds the approved payment and cost limit');
      const changed=[...state];pending={...pending,debit:String(debit)};changed[next]=pending;
      const saved=await db.prepare('UPDATE swarm_wallet_batches SET progress=? WHERE reference=? AND mode=? AND progress=? AND items=? AND done=0')
        .bind(JSON.stringify(changed),row.external_id,mode,batch.progress,batch.items).run();
      if(!saved.meta.changes)throw Error('Wallet state changed. Resume the same invoice.');
    }
    if(status&&pending.debit==null)throw Error('A staged transaction landed outside the workspace. Reconcile its costs first.');
    if(!status){const sent=await services.broadcast(pending.bytes);if(sent!==pending.signature)throw Error('Broadcast signature does not match the wallet');return {status:'confirming',step:next,signature:sent};}
    if(status.err)throw Error('This wallet transaction failed on Solana');
    if(!['confirmed','finalized'].includes(status.confirmationStatus))return {status:'confirming',step:next,signature:pending.signature};
    const before=(await load()).progress,progress=JSON.parse(before);
    if(progress[next]?.signature!==pending.signature)throw Error('Pending transaction changed');
    progress[next]={signature:pending.signature,debit:pending.debit,landed:true};
    await db.prepare('UPDATE swarm_wallet_batches SET progress=? WHERE reference=? AND mode=? AND progress=?').bind(JSON.stringify(progress),row.external_id,mode,before).run();
    return {status:'step-confirmed',step:next,signature:pending.signature};
  }
  const signatures=state.map(x=>x.signature),payload={routeInitSignatures:[],sessionInitSignatures:[],dispersionInitSignatures:[]};
  const fields={route:'routeInitSignatures',session:'sessionInitSignatures',dispersion:'dispersionInitSignatures'};
  items.forEach((x,i)=>{if(fields[x.kind])payload[fields[x.kind]].push(signatures[i]);else if(x.kind==='keeper')payload.keeperFundingSignature=signatures[i];else if(x.kind==='orchestrator')payload.orchestratorInitSignature=signatures[i];});
  const key=await hashHex('swarm-confirm:'+row.external_id+':'+mode);
  if(rescue)await services.confirmRefund(row.transfer_id,{rescueSignatures:signatures},key);
  else await services.confirmPayment(row.transfer_id,payload,key);
  const changes=[db.prepare('UPDATE swarm_wallet_batches SET done=1 WHERE reference=? AND mode=?').bind(row.external_id,mode)];
  if(rescue)changes.push(db.prepare('UPDATE swarm_invoices SET rescue_messages=? WHERE external_id=?').bind(JSON.stringify(items.map(i=>i.digest)),row.external_id));
  await db.batch(changes);
  return {mode,status:'submitted',signatures};
}
