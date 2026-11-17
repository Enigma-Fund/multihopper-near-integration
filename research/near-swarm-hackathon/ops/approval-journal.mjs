// This is called only by the explicit user approval endpoint.
// A saved signature is always reconciled; retries never create a replacement.
export function approvalJournal({load,save,prepare,sign,pack,broadcast,resolve}){
  let busy=false;
  return async(key,request)=>{
    if(busy)throw Error('Another signature is being reviewed');
    busy=true;
    try{
      const existing=await load(key);
      if(existing)return resolve(existing);
      let plan;
      try{plan=await prepare(request);}catch(error){error.notSigned=true;throw error;}
      const signature=await sign(plan);
      const row=await pack(key,request,plan,signature);
      await save(key,row);
      if(row.kind==='near-sign')await broadcast(row);
      return resolve(row);
    }finally{busy=false;}
  };
}
