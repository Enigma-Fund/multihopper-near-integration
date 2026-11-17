import {signedMessage,verifyOrderSignature,JOB_MINT,approvalRecord} from './orders.mjs';
import {hashHex,verifyNearJob} from './near-job.mjs';
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
  let origin;
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
  }
}

export async function settleOrder(db,origin,body,services){
  await verifyOrderSignature(origin,body);
  return settleVerifiedOrder(db,origin,body,services);
}
async function settleVerifiedOrder(db,origin,body,services){
  const {owner,id,action}=body;
  const job=await db.prepare('SELECT recipient,budget,cap,state FROM swarm_orders WHERE owner=? AND id=?').bind(owner,id).first();
  if(!job)throw Error('Work order not found for this wallet');
  const binding=()=>db.prepare('SELECT * FROM swarm_near_links WHERE owner=? AND id=?').bind(owner,id).first();
  if(action==='link'){
    if(job.state!=='open')throw Error('Work order is closed');
    const verified=await verifyNearJob(origin,body,job,services.accessKey);
    await db.batch([db.prepare(`INSERT INTO swarm_near_links(owner,id,near_owner,near_job,job_key,access_block)
      SELECT owner,id,?,?,?,? FROM swarm_orders WHERE owner=? AND id=? AND state='open' ON CONFLICT DO NOTHING`)
      .bind(body.nearOwner,body.nearJobId,verified.key,verified.block,owner,id),approvalRecord(db,origin,body,'',verified.key)]);
    const link=await binding();
    if(link?.job_key!==verified.key)throw Error('This NEAR job or work order already has another binding, or the order closed');
    return {jobKey:link.job_key,nearAccount:link.near_owner,nearJobId:link.near_job,accessBlock:link.access_block};
  }
  if(!['invoice','refresh','prepare-refund','prepare-wallet','wallet-step'].includes(action))throw Error('Invalid settlement action');
  const link=await binding();
  if(!link)throw Error('Link the NEAR job to this work order first');
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
  await verifyStoredTerms(db,job,link,row);
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
  if(action==='prepare-wallet'||action==='wallet-step'){
    if(action==='wallet-step' && (!Number.isSafeInteger(body.step)||body.step<0||body.step>100))throw Error('Invalid wallet step');
    if(action==='prepare-wallet'&&body.mode==='payment')await screeningSigner(services.account);
    return walletBatch(db,services,row,{...body,canRescue:transfer.recovery?.canRescue===true},job);
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
  }else if(transfer.phase==='settled'&&transfer.destinations?.[0].status==='paid'){
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
