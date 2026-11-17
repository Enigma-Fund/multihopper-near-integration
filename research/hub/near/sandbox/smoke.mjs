import {Sandbox} from './node.mjs';
let s;
try{s=await Sandbox.create();console.log('LOCAL_SANDBOX',s.chainId);await s.bootstrap();console.log('WASM_DEPLOYED_LOCALLY');await s.rpc.call('synthetic','usd.synthetic','mint',{account:'alice.synthetic',amount:'100'});console.log('BALANCE',await s.rpc.view('usd.synthetic','balance',{account:'alice.synthetic'}));}
finally{if(s)await s.cleanup();}
