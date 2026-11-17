// Browser-native implementation of Meteor's published v1 web messaging protocol.
// No SDK code, wallet keys, external scripts or automatic transaction retry.
export const METEOR_ORIGIN='https://wallet.meteorwallet.app';
export function meteorRequest(actionType,inputs,popup,{host=window,timeout=240000}={}){
  if(!['sign','sign_message'].includes(actionType)||!popup||popup.closed)throw Error('Allow the NEAR wallet window to review this operation.');
  const uid=crypto.randomUUID(),url=new URL('/connect/mainnet/'+actionType,METEOR_ORIGIN);
  url.search=new URLSearchParams({source:'wpm',connectionUid:uid,pageUri:encodeURIComponent(host.location.href)}).toString();
  let status='initializing',timer,finished=false;
  return new Promise((resolve,reject)=>{
    const deadline=Date.now()+timeout;
    function send(){popup.postMessage({uid,actionType,status,network:'mainnet',endTags:[],...(status==='initializing'?{inputs}:{})},METEOR_ORIGIN);}
    function done(fn,value){if(finished)return;finished=true;clearInterval(timer);host.removeEventListener('message',receive);fn(value);}
    function receive(event){
      if(event.source!==popup||event.origin!==METEOR_ORIGIN||event.data?.uid!==uid)return;
      const data=event.data;
      if(data.status==='attempting_reconnect'){status='initializing';send();}
      else if(data.status==='connected')status='connected';
      else if(data.status==='closed_success'){status='closed_success';send();done(resolve,data.payload);}
      else if(['closed_fail','closed_window','disconnected'].includes(data.status))done(reject,Error('The NEAR wallet did not complete this request. Resume the same job or invoice to check its state.'));
    }
    host.addEventListener('message',receive);
    popup.location.href=url.href;
    timer=setInterval(()=>{
      if(popup.closed||Date.now()>deadline)done(reject,Error('NEAR approval closed or timed out. Resume the same job or invoice; no replacement payment was sent.'));
      else send();
    },500);
    send();
  });
}
