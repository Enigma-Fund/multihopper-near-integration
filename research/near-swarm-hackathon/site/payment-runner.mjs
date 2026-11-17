// Authorization messages are completed before the server prepares expiring chain
// transactions. The server remains the authority for renewal and reconciliation.
export async function runPayment({authorize,prepare,submit,sign,onReview=()=>{},pause=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}){
  let permission=await authorize('wallet-step');
  let preparation=await authorize('prepare-wallet');
  async function current(){
    if(preparation.expires<now()+4000)preparation=await authorize('prepare-wallet');
    return prepare(preparation);
  }
  let packet=await current();
  if(packet.status==='submitted'||!packet.items)return packet;
  const count=packet.items.length;
  for(let i=0;i<count;i++){
    if(i>0)packet=await current();
    if(packet.status==='submitted')return packet;
    if(packet.items?.length!==count)throw Error('Prepared transaction count changed. Resume the same invoice.');
    if(packet.items[i].confirmed)continue;
    if(permission.expires<now()+4000){permission=await authorize('wallet-step');packet=await current();}
    if(packet.status==='submitted')return packet;
    if(packet.items?.length!==count)throw Error('Prepared transaction count changed. Resume the same invoice.');
    const item=packet.items?.[i];
    if(!item)throw Error('The payment needs reconciliation.');
    if(item.confirmed)continue;
    onReview(i,count);
    const signed=item.pending?undefined:await sign(item.bytes);
    async function step(){
      if(permission.expires<now()+4000)permission=await authorize('wallet-step');
      return submit(permission,i,signed);
    }
    let result=await step();
    while(result.status==='confirming'){
      await pause(1500);
      if(permission.expires<now()+4000)permission=await authorize('wallet-step');
      result=await submit(permission,i);
    }
    if(result.status!=='step-confirmed')throw Error('Unexpected transaction status. Check this invoice again.');
  }
  if(permission.expires<now()+4000)permission=await authorize('wallet-step');
  return submit(permission,count);
}
