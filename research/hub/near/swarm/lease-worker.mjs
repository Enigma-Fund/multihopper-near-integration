import {ProcessLease} from '../ordinary/lease.mjs';
let lease;
process.on('SIGTERM',()=>{lease?.close();process.exit(0);});
try{lease=new ProcessLease(process.argv[2],'test worker');process.stdout.write('LOCKED\n');setInterval(()=>{},1000);}catch{process.exit(2);}
