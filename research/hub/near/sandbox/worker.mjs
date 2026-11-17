// Only invoked by local fault-injection tests. Configuration has no key material.
import {readFileSync} from 'node:fs';
import {LocalNear} from './rpc.mjs';
import {Coordinator} from './coordinator.mjs';
const [configFile,stage,action,...args]=process.argv.slice(2);
const cfg=JSON.parse(readFileSync(configFile));const rpc=new LocalNear(cfg.port,cfg.chainId);
const c=new Coordinator(cfg.journal,rpc,'exit:'+stage);
try{if(action==='dispatch')await c.dispatch(args[0]);else if(action==='recover')await c.recover(args[0],args[1]);else if(action==='authorize')await c.authorize(args[0],args[1],args[2]);else throw Error('invalid fault action');}finally{c.close();}
