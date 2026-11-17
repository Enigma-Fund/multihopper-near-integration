// One scoped invoice message, then one variadic wallet transaction request.
// Persist the entire signed batch before executing any of it. Never re-sign on
// an uncertain response; a later resume reconciles the durable signatures.
export async function runBatchPayment({authorize,request,signAll,onProgress=()=>{},onSummary=()=>{},pause=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}){
  const permission=await authorize('wallet-run');
  async function call(operation,fields={}){
    if(permission.expires<=now())throw Error('Invoice authorization expired. Resume the same invoice; saved signatures remain intact.');
    for(let attempt=0;;attempt++){
      try{return await request({...permission,operation,...fields});}
      catch(error){if(error.status!==503||attempt>=2)throw error;await pause(500*(attempt+1));}
    }
  }
  let packet=await call('prepare');
  if(packet.summary)onSummary(packet.summary);
  if(packet.status==='submitted'||!packet.items)return packet;
  // Finish any earlier, already-signed prefix before asking for fresh signatures.
  while(packet.items.some(x=>x.pending)){
    await settle(packet.items.findIndex(x=>x.pending));
    packet=await call('prepare');
    if(packet.status==='submitted')return packet;
  }
  const missing=packet.items.flatMap((item,step)=>item.confirmed||item.pending?[]:[{...item,step}]);
  if(missing.length){
    if(missing.length>12)throw Error('This payment exceeds the supported twelve-transaction wallet batch. Nothing new was signed.');
    onProgress('Review '+missing.length+' remaining transactions together in your wallet.');
    const signed=await signAll(missing.map(x=>x.bytes));
    if(!Array.isArray(signed)||signed.length!==missing.length)throw Error('Wallet returned an incomplete batch. Resume the same invoice.');
    await call('stage',{signedTransactions:signed.map((bytes,i)=>({step:missing[i].step,bytes}))});
  }
  for(let i=0;i<packet.items.length;i++)if(!packet.items[i].confirmed)await settle(i);
  return call('step',{step:packet.items.length});
  async function settle(step){
    onProgress('Confirming payment step '+(step+1)+' automatically.');
    let result=await call('step',{step});
    while(result.status==='confirming'){await pause(1500);result=await call('step',{step});}
    if(result.status!=='step-confirmed')throw Error('Unexpected payment state. Resume the same invoice.');
  }
}
