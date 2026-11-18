import {reconcilePending} from './durable.mjs';
import {settlementServices} from './settlement-client.mjs';
// Deploy separately from Pages with a one-minute Cron Trigger and the SAME dedicated D1.
// There is deliberately no public HTTP trigger and no wallet key or broadcast call.
export default {
 scheduled(_event,env,ctx){ctx.waitUntil(reconcilePending(env.SWARM_JOBS,settlementServices(env)));},
 fetch(){return new Response('Not found',{status:404});}
};
