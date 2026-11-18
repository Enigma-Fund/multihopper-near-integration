// Live deployment: swarm-settlement-reconciler, one-minute cron.
// Only this narrow verification token is needed; no wallet or API credentials.
export default {
 async scheduled(_event,env,ctx){
  ctx.waitUntil((async()=>{
   const r=await fetch('https://multihopper-swarm-for-hire.pages.dev/near-swarm/api/reconcile',{
    method:'POST',headers:{Authorization:'Bearer '+env.RECONCILE_TOKEN}});
   if(!r.ok)throw Error('Reconciliation failed: '+r.status);
  })());
 },
 fetch(){return new Response('Not found',{status:404});}
};
