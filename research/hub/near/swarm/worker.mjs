import {readFileSync} from 'node:fs';
import {LocalNear} from '../sandbox/rpc.mjs';
import {ProviderClient} from '../ordinary/client.mjs';
import {SwarmJobs} from './jobs.mjs';
const [path,stage,method,args]=process.argv.slice(2);const c=JSON.parse(readFileSync(path));const provider=new ProviderClient(c.providerConfig);await provider.ready;
const jobs=new SwarmJobs(c.directory,new LocalNear(c.port,c.chainId),provider,stage);
try{await jobs[method](...JSON.parse(args));}finally{jobs.close();await provider.close();}
