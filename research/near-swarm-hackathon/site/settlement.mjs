import {requireNearJob,requireNearInvoice,jobTermsHash,NEAR_JOB_STORAGE,NEAR_INVOICE_STORAGE} from './near-contract.mjs';
import {signedMessage,verifyOrderSignature,JOB_MINT,approvalRecord} from './orders.mjs';
import {hashHex,verifyNearJob,verifyNearSignature} from './near-job.mjs';
import {messageHash,verifyPayout,verifyRecovery,verifyPaymentScreen,screeningSigner} from './settlement-evidence.mjs';
import {walletBatch} from './wallet-bundle.mjs';
import {ServiceUnavailable} from './settlement-client.mjs';

const invoiceQuery='SELECT owner,id,invoice,external_id,CAST(amount AS TEXT) AS amount,CAST(minimum AS TEXT) AS minimum,transfer_id,quoted_net,rescue_messages,outcome,received,evidence FROM swarm_invoices WHERE owner=? AND invoice=?';
function displayInvoice(row,jobKey){
  return {jobKey,workOrder:row.id,invoice:row.invoice,transferId:row.transfer_id,reference:row.external_id,grossLamports:row.amount,
    minimumLamports:row.minimum,quotedNetLamports:row.quoted_net,status:row.outcome||(row.transfer_id?'quoted':'reserved'),
    creditedLamports:row.received,transactions:row.evidence?JSON.parse(row.evidence):[]};
}
function matchesQuote(t,row,job,test){
  if(!t || t.isTest!==test || t.externalId!==row.external_id || t.sourceOwner!==row.owner || t.tokenMint!==JOB_MINT ||
     String(t.amountRaw)!==row.amount || !/^[1-9]\d{0,15}$/.test(String(t.id)) || row.transfer_id && String(t.id)!==row.transfer_id ||
     !/^[1-9]\d{0,17}$/.test(t.recipientReceivesRaw) || BigInt(t.recipientReceivesRaw)<BigInt(row.minimum) ||
     BigInt(t.recipientReceivesRaw)>BigInt(row.amount) || row.quoted_net && row.quoted_net!==t.recipientReceivesRaw ||
     t.destinationCount!==1 || t.recipientWallet!=null && t.recipientWallet!==job.recipient)throw Error('The API transfer does not match the signed invoice');
  if(t.destinations!=null && (!Array.isArray(t.destinations)||t.destinations.length!==1 ||
    t.destinations[0].wallet!==job.recipient || String(t.destinations[0].amountRaw)!==t.recipientReceivesRaw))throw Error('The payout destination or amount changed');
}
async function verifyStoredTerms(db,job,link,row){
  const expected=[
    ['create','',{recipient:job.recipient,budget:job.budget,limit:job.cap}],
    ['link','',{nearOwner:link.near_owner,nearJobId:link.near_job}],
    ['invoice',row.invoice,{invoice:row.invoice,recipient:job.recipient,amount:row.amount,minimum:row.minimum}]
  ];
  let origin,nearProof;
  for(const [action,item,fields] of expected){
    const record=await db.prepare('SELECT statement FROM swarm_approvals WHERE owner=? AND id=? AND kind=? AND item=?').bind(row.owner,row.id,action,item).first();
    if(!record)throw Error('The signed work-order evidence is missing');
    const proof=JSON.parse(record.statement);
    if(origin&&origin!==proof.origin)throw Error('Work order and invoice were signed for different sites');
    origin=proof.origin;
    const expires=proof.expires??Date.parse(proof.message.split('\n').at(-1).slice(9));
    const then=proof.acceptedAt??expires-1;
    const body={id:row.id,owner:row.owner,action,expires,...fields,signature:proof.signature};
    if(signedMessage(origin,body,then)!==proof.message)throw Error('Stored payment terms differ from the signed work order');
    await verifyOrderSignature(origin,body,then);
    if(action==='link'){await verifyNearSignature(origin,{...body,nearProof:proof.nearProof},job);nearProof=proof.nearProof;}
  }
  const jobKey=await hashHex(JSON.stringify(['swarm-job-v1',link.near_owner,link.near_job]));
  const invoiceKey=await hashHex(JSON.stringify(['swarm-invoice-v1',origin,row.owner,row.id,jobKey,row.invoice,job.recipient,row.amount,row.minimum]));
  if(link.job_key!==jobKey||row.external_id!==invoiceKey)throw Error('The stored references differ from the signed job and invoice');
  return {origin,nearProof};
}

export async function settleOrder(db,origin,body,services){
  await verifyOrderSignature(origin,body);
  return settleVerifiedOrder(db,origin,body,services);
}
async function settleVerifiedOrder(db,origin,body,services){
  body={...body,batchReview:false};
  const {owner,id}=body;
  let action=body.action;
  if(action==='wallet-run'){
    if(!['prepare','stage','step'].includes(body.operation))throw Error('Invalid invoice operation');
    action=body.operation==='prepare'?'prepare-wallet':body.operation==='stage'?'stage-wallet':'wallet-step';
    body={...body,action,batchReview:true};
  }
  const job=await db.prepare('SELECT recipient,budget,cap,state FROM swarm_orders WHERE owner=? AND id=?').bind(owner,id).first();
  if(!job)throw Error('Work order not found for this wallet');
  if(action==='cancel-job'){
    await db.prepare("UPDATE swarm_orders SET state='closed' WHERE owner=? AND id=?").bind(owner,id).run();
    const invoices=(await db.prepare('SELECT invoice,transfer_id,outcome FROM swarm_invoices WHERE owner=? AND id=?').bind(owner,id).all()).results;
    const recovery=[];
    for(const invoice of invoices){
      if(invoice.outcome||!invoice.transfer_id){recovery.push({invoice:invoice.invoice,status:invoice.outcome||'unfunded',canRecover:false});continue;}
      try{const t=await services.status(invoice.transfer_id);recovery.push({invoice:invoice.invoice,status:t.phase,canRecover:t.recovery?.canRescue===true,availableLamports:String(t.recovery?.rescuableLamports??0)});}
      catch{recovery.push({invoice:invoice.invoice,status:'verification-pending',canRecover:false});}
    }
    return {status:'job-stopped',recovery,note:'Workspace payment initiation stopped. Already signed or submitted transactions may still execute. This does not cancel a healthy on-chain route or refund funds.'};
  }
  const binding=()=>db.prepare('SELECT * FROM swarm_near_links WHERE owner=? AND id=?').bind(owner,id).first();
  if(action==='link'){
    if(job.state!=='open')throw Error('Work order is closed');
    const verified=await verifyNearJob(origin,body,job,services.accessKey);
    if(!services.expectedTest&&!services.near)throw new ServiceUnavailable('The NEAR job contract is awaiting activation.');
    if(services.near){
      const state=await requireNearJob(services.near,origin,body,job,verified.key);
      const args={
        job_key:verified.key,job_id:body.nearJobId,agent:body.nearOwner,
        terms_hash:await jobTermsHash(origin,body,job),budget:job.budget,per_payment:job.cap
      };
      if(body.nearTransactionHash)await services.near.verifyOperation(body.nearTransactionHash,body.nearOwner,'create_job',args);
      if(!state)return services.near.prepare(body.nearOwner,body.nearProof.publicKey,'create_job',args,NEAR_JOB_STORAGE);
      if(state.closed)throw Error('The NEAR job is closed');
    }
    await db.batch([db.prepare(`INSERT INTO swarm_near_links(owner,id,near_owner,near_job,job_key,access_block)
      SELECT owner,id,?,?,?,? FROM swarm_orders WHERE owner=? AND id=? AND state='open' ON CONFLICT DO NOTHING`)
      .bind(body.nearOwner,body.nearJobId,verified.key,verified.block,owner,id),approvalRecord(db,origin,body,'',verified.key)]);
    const link=await binding();
    if(link?.job_key!==verified.key)throw Error('This NEAR job or work order already has another binding, or the order closed');
    return {jobKey:link.job_key,nearAccount:link.near_owner,nearJobId:link.near_job,accessBlock:link.access_block};
  }
  if(!['invoice','refresh','prepare-refund','prepare-wallet','stage-wallet','wallet-step','publish-receipt','close-near'].includes(action))throw Error('Invalid settlement action');
  const link=await binding();
  if(!link)throw Error('Link the NEAR job to this work order first');
  if(action==='close-near'){
    if(!services.near)throw new ServiceUnavailable('The NEAR contract is unavailable');
    const saved=await db.prepare("SELECT statement FROM swarm_approvals WHERE owner=? AND id=? AND kind='link' AND item=''").bind(owner,id).first();
    if(!saved)throw Error('The signed NEAR link is missing');
    const proof=JSON.parse(saved.statement),nearBody={owner,id,nearOwner:link.near_owner,nearJobId:link.near_job,nearProof:proof.nearProof,expires:proof.expires};
    await verifyNearSignature(proof.origin,nearBody,job);
    const state=await requireNearJob(services.near,proof.origin,nearBody,job,link.job_key);
    if(!state)throw Error('The NEAR job does not exist');
    if(body.nearTransactionHash)await services.near.verifyOperation(body.nearTransactionHash,link.near_owner,'close_job',{job_key:link.job_key});
    if(!state.closed)return services.near.prepare(link.near_owner,proof.nearProof.publicKey,'close_job',{job_key:link.job_key},'0');
    await db.prepare("UPDATE swarm_orders SET state='closed' WHERE owner=? AND id=?").bind(owner,id).run();
    return {jobKey:link.job_key,status:'closed',near:{contract:services.near.contract,status:'confirmed'}};
  }
  const load=()=>db.prepare(invoiceQuery).bind(owner,body.invoice).first();
  let row=await load();
  if(action==='invoice'){
    if(body.recipient!==job.recipient || BigInt(body.amount)>BigInt(job.cap))throw Error('Invoice exceeds the signed spending limit or uses another recipient');
    if(!row){
      if(!services.configured)throw new ServiceUnavailable('Production quotes are unavailable until the workspace is connected to the MultiHopper API.');
      const ref=await hashHex(JSON.stringify(['swarm-invoice-v1',origin,owner,id,link.job_key,body.invoice,body.recipient,body.amount,body.minimum]));
      await db.batch([db.prepare(`INSERT INTO swarm_invoices(owner,id,invoice,external_id,amount,minimum)
        SELECT owner,id,?,?,CAST(? AS INTEGER),CAST(? AS INTEGER) FROM swarm_orders j
        WHERE j.owner=? AND j.id=? AND j.state='open' AND CAST(? AS INTEGER)<=CAST(j.budget AS INTEGER)
        - COALESCE((SELECT SUM(i.amount) FROM swarm_invoices i WHERE i.owner=j.owner AND i.id=j.id),0)
        ON CONFLICT DO NOTHING`).bind(body.invoice,ref,body.amount,body.minimum,owner,id,body.amount),approvalRecord(db,origin,body,body.invoice,ref)]);
      row=await load();
    }
    if(!row||row.amount!==body.amount||row.minimum!==body.minimum)throw Error('Invoice conflicts with the job budget, lifecycle or existing terms');
  }
  if(!row||row.id!==id)throw Error('Invoice not found for this work order');
  const stored=await verifyStoredTerms(db,job,link,row);
  if(body.batchReview&&action==='wallet-step'){
    if(!Number.isSafeInteger(body.step)||body.step<0||body.step>100||body.signedTx!==undefined)throw Error('Execute the stored signed batch only');
    const saved=await db.prepare('SELECT * FROM swarm_wallet_batches WHERE reference=? AND mode=?').bind(row.external_id,body.mode).first();
    if(!saved)throw Error('Store the reviewed transaction batch first');
    const items=JSON.parse(saved.items),progress=JSON.parse(saved.progress||'[]');
    if(body.step<items.length&&!progress[body.step])throw Error('Store the entire reviewed batch before execution');
    // Admission and NEAR reservation were verified before these exact signatures
    // were stored. Progress checks need Solana finality, not repeated NEAR reads.
    const result=await walletBatch(db,services,row,body,job);
    if(body.mode==='recovery' && result.status==='submitted')return settleVerifiedOrder(db,origin,{...body,action:'refresh'},services);
    return result;
  }
  if(!services.expectedTest&&!services.near)throw new ServiceUnavailable('The NEAR job contract is awaiting activation.');
  if(services.near){
    const nearBody={owner,id,nearOwner:link.near_owner,nearJobId:link.near_job};
    const state=await requireNearJob(services.near,stored.origin,nearBody,job,link.job_key);
    if(!state)throw Error('The NEAR job has no finalized on-chain record');
    const reservation=await requireNearInvoice(services.near,link.job_key,row);
    if(body.nearTransactionHash&&action==='invoice')await services.near.verifyOperation(body.nearTransactionHash,link.near_owner,'reserve_invoice',{
      job_key:link.job_key,invoice_key:row.external_id,amount:row.amount,minimum:row.minimum
    });
    if(!reservation){
      if(action!=='invoice'||state.closed||job.state!=='open')throw Error('The NEAR invoice has no spending authorization');
      return services.near.prepare(link.near_owner,stored.nearProof.publicKey,'reserve_invoice',{
        job_key:link.job_key,invoice_key:row.external_id,amount:row.amount,minimum:row.minimum
      },NEAR_INVOICE_STORAGE);
    }
    if(['invoice','prepare-wallet'].includes(action)&&state.closed&&body.mode!=='recovery')throw Error('The NEAR job is closed');
    if(!row.outcome&&reservation.status!=='reserved')throw Error('Reconcile the terminal NEAR receipt before another payment');
    if(action==='publish-receipt'){
      if(!row.outcome||!row.evidence)throw Error('A finalized Solana payout or refund is required first');
      const transfer=await services.status(row.transfer_id);
      matchesQuote(transfer,row,job,services.expectedTest);
      const saved=JSON.parse(row.evidence);
      if(row.outcome==='payout-confirmed'){
        if(transfer.destinations?.[0]?.status!=='paid'||transfer.destinations?.[0]?.payoutSignature!==saved[0]?.signature||row.received!==row.quoted_net)throw Error('Payout evidence requires reconciliation');
        await verifyPayout(services.transaction,saved[0].signature,job.recipient,row.quoted_net,services.program);
        await verifyPaymentScreen(await services.transaction(saved[0].signature,'jsonParsed'),owner,job.recipient,await screeningSigner(services.account),services.program);
      }else{
        if(transfer.phase!=='rescued'||!row.rescue_messages)throw Error('Refund evidence requires reconciliation');
        const checked=await verifyRecovery(services.transaction,saved.map(r=>r.signature),JSON.parse(row.rescue_messages),owner,services.program);
        if(checked.received!==row.received)throw Error('Refund credit differs from the confirmed receipt');
      }
      const receipt={job_key:link.job_key,invoice_key:row.external_id,
        outcome:row.outcome==='payout-confirmed'?'paid':'refunded',credited:row.received,evidence_hash:await hashHex(row.evidence)};
      if(body.nearTransactionHash)await services.near.verifyOperation(body.nearTransactionHash,link.near_owner,'record_settlement',receipt);
      if(reservation.status!=='reserved'){
        if(reservation.status!==receipt.outcome||reservation.credited!==receipt.credited||reservation.evidence_hash!==receipt.evidence_hash)throw Error('The NEAR settlement conflicts with the verified Solana receipt');
        return {...displayInvoice(row,link.job_key),near:{contract:services.near.contract,status:'confirmed',invoiceKey:row.external_id,evidenceHash:receipt.evidence_hash}};
      }
      return services.near.prepare(link.near_owner,stored.nearProof.publicKey,'record_settlement',await services.near.attest(receipt),'0');
    }
  }
  if(row.outcome)return displayInvoice(row,link.job_key);
  if(!services.configured)throw new ServiceUnavailable('The production Solana API connection is unavailable');
  let transfer=row.transfer_id?await services.status(row.transfer_id):await services.find(row.external_id);
  if(!transfer && !row.transfer_id && action==='invoice'){
    if(job.state!=='open')throw Error('Work order is closed');
    const units=BigInt(row.amount);
    transfer=await services.create({sourceOwner:owner,tokenMint:JOB_MINT,tokenDecimals:9,amountRaw:row.amount,
      amountTokens:(units/1000000000n)+'.'+(units%1000000000n).toString().padStart(9,'0'),
      destinations:[{wallet:job.recipient,amountRaw:row.amount}],externalId:row.external_id},row.external_id);
  }
  if(!transfer)return displayInvoice(row,link.job_key);
  matchesQuote(transfer,row,job,services.expectedTest);
  if(!row.transfer_id){
    await db.prepare('UPDATE swarm_invoices SET transfer_id=?,quoted_net=? WHERE external_id=? AND transfer_id IS NULL')
      .bind(String(transfer.id),transfer.recipientReceivesRaw,row.external_id).run();
    row=await load();matchesQuote(transfer,row,job,services.expectedTest);
  }
  if(action==='prepare-wallet'||action==='stage-wallet'||action==='wallet-step'){
    if(action==='wallet-step' && (!Number.isSafeInteger(body.step)||body.step<0||body.step>100))throw Error('Invalid wallet step');
    if(action==='prepare-wallet'&&body.mode==='payment')await screeningSigner(services.account);
    const result=await walletBatch(db,services,row,{...body,canRescue:transfer.recovery?.canRescue===true},job);
    // The same invoice authorization covers checking the batch just submitted.
    // Never prepare another payment or infer a refund from the API label alone.
    if(body.mode==='recovery' && result.status==='submitted'){
      return settleVerifiedOrder(db,origin,{...body,action:'refresh'},services);
    }
    return {...result,...(body.batchReview&&action==='prepare-wallet'?{summary:{job,invoice:row.invoice,amount:row.amount,net:row.quoted_net}}:{})};
  }
  if(action==='prepare-refund'){
    if(!['recoverable','failed'].includes(transfer.phase)||transfer.recovery?.canRescue!==true)throw Error('The route has no recoverable funds');
    const bundle=await services.prepareRefund(row.transfer_id,await hashHex('refund:'+row.external_id));
    if(!Array.isArray(bundle?.rescueTxs)||!bundle.rescueTxs.length||bundle.rescueTxs.length>12)throw Error('Incomplete API recovery bundle');
    const messages=JSON.stringify(await Promise.all(bundle.rescueTxs.map(tx=>messageHash(tx.base64))));
    await db.prepare('UPDATE swarm_invoices SET rescue_messages=? WHERE external_id=? AND outcome IS NULL AND (rescue_messages IS NULL OR rescue_messages=?)')
      .bind(messages,row.external_id,messages).run();
    if((await load()).rescue_messages!==messages)throw Error('Existing recovery needs reconciliation');
    return {...displayInvoice(row,link.job_key),status:'recovery-prepared',transactionsPrepared:bundle.rescueTxs.length};
  }
  let receipts,received,outcome;
  const recovered=transfer.phase==='rescued' && row.rescue_messages && await db.prepare("SELECT progress FROM swarm_wallet_batches WHERE reference=? AND mode='recovery' AND done=1").bind(row.external_id).first();
  const refundSignatures=body.refundSignatures || (recovered && JSON.parse(recovered.progress).map(s=>s.signature));
  if(refundSignatures){
    if(transfer.phase!=='rescued'||!row.rescue_messages)throw Error('A route-specific prepared and confirmed rescue is required');
    const verified=await verifyRecovery(services.transaction,refundSignatures,JSON.parse(row.rescue_messages),owner,services.program);
    receipts=verified.receipts;received=verified.received;outcome='recovery-credit-confirmed';
  }else if(transfer.destinations?.[0]?.status==='paid'){
    // Aggregate route phase may advance to reclaimed after payout. Verify the
    // finalized recipient credit and screening proof rather than that label.
    const signature=transfer.destinations[0].payoutSignature;
    if(!signature)return {...displayInvoice(row,link.job_key),status:'awaiting-payout-evidence'};
    receipts=[await verifyPayout(services.transaction,signature,job.recipient,row.quoted_net,services.program)];
    receipts[0].screening=await verifyPaymentScreen(await services.transaction(signature,'jsonParsed'),owner,job.recipient,await screeningSigner(services.account),services.program);
    received=row.quoted_net;outcome='payout-confirmed';
  }else return {...displayInvoice(row,link.job_key),phase:transfer.phase??transfer.status};
  // The receipt and all its unique signatures are committed in the same D1 transaction.
  const statements=receipts.map(r=>db.prepare('INSERT INTO swarm_final_signatures(signature,external_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM swarm_invoices WHERE external_id=? AND outcome IS NULL) ON CONFLICT(signature) DO UPDATE SET external_id=CASE WHEN excluded.external_id=external_id THEN external_id ELSE NULL END').bind(r.signature,row.external_id,row.external_id));
  statements.push(db.prepare('UPDATE swarm_invoices SET outcome=?,received=?,evidence=? WHERE external_id=? AND outcome IS NULL')
    .bind(outcome,received,JSON.stringify(receipts),row.external_id));
  await db.batch(statements);
  const final=await load();
  if(final.outcome!==outcome||final.evidence!==JSON.stringify(receipts))throw Error('Conflicting final settlement');
  return displayInvoice(final,link.job_key);
}

// A verified notification can request observation only. It cannot prepare, sign or broadcast.
export async function observeSettlement(db,services,event){
  if(typeof event?.externalId!=='string'||!/^[0-9a-f]{64}$/.test(event.externalId))return;
  const row=await db.prepare('SELECT owner,id,invoice,transfer_id FROM swarm_invoices WHERE external_id=?').bind(event.externalId).first();
  if(!row || row.transfer_id && row.transfer_id!==String(event.transferId))return;
  return settleVerifiedOrder(db,null,{action:'refresh',owner:row.owner,id:row.id,invoice:row.invoice},services);
}
