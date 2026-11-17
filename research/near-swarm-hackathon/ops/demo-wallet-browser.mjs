const $=id=>document.getElementById(id),allowed=new Set(['https://multihopper-swarm-for-hire.pages.dev','https://business.multihopper.com']);
const uid=new URL(location.href).searchParams.get('uid');let id,requestOrigin,received=false;
async function post(path,data={}){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const b=await r.json();if(!r.ok){const e=Error(b.error);e.retryable=b.retryable;e.notSigned=b.notSigned;throw e;}return b;}
function ready(row){id=row.id;$('review').textContent=row.review;$('approve').disabled=false;}
function success(result){$('status').textContent='Confirmed. '+(result.executionOutcomes?.[0]?.transaction?.hash||'Signature returned to the website.');$('approve').disabled=true;
  if(uid&&opener)opener.postMessage({uid,result},requestOrigin);}
$('approve').onclick=async()=>{
  $('approve').disabled=true;$('status').textContent='Review the native macOS approval window.';
  try{success((await post('/approve',{id})).result);}catch(e){$('status').textContent=e.message;if(e.notSigned){$('status').textContent+=' Nothing signed or sent. Resume the same invoice.';if(uid&&opener)opener.postMessage({uid,error:$('status').textContent},requestOrigin);}else if(e.retryable)$('approve').disabled=false;else $('check').hidden=false;}
};
$('check').onclick=async()=>{try{success((await post('/status',{id})).result);}catch(e){$('status').textContent=e.message;}};
if(uid){
  $('title').textContent='Review this website operation';$('approve').textContent='Approve signature';$('review').textContent='Waiting for the website request…';
  const listener=async event=>{
    if(received||event.source!==opener||!allowed.has(event.origin)||event.data?.uid!==uid)return;
    received=true;requestOrigin=event.origin;window.removeEventListener('message',listener);
    try{
      if(event.data.kind==='connect'){const info=await(await fetch('/info')).json();opener.postMessage({uid,result:info},event.origin);$('review').textContent='Connected to the dedicated demo accounts.';$('status').textContent='Continue in the Swarm workspace. This window will show the next operation for review.';return;}
      ready(await post('/request',{origin:event.origin,kind:event.data.kind,inputs:event.data.inputs}));
    }catch(e){$('status').textContent=e.message;opener.postMessage({uid,error:e.message},event.origin);}
  };
  window.addEventListener('message',listener);
}else{
  try{const row=await post('/prepare-deployment');if(row.deployed){$('review').textContent='The reviewed NEAR contract is already deployed and configured.\n'+row.account;$('status').textContent='No second deployment will be submitted.';}else ready(row);}
  catch(e){$('review').textContent=e.message;}
}
