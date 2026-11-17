import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,openSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {LocalNear,key,actions,sha,base58} from './rpc.mjs';
export const ROOT=dirname(fileURLToPath(import.meta.url));
export const BINARY='/tmp/mh-near-sandbox-intake-20261104/near-sandbox';
const BIN_SHA='8e0e1521372b0fce801b7464078c1e95e5a25a0f92ad4b4241451c33fe9e5a2a';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const p=s.address().port;await new Promise(r=>s.close(r));return p;}
export class Sandbox {
 static async create(options={}){
  if(sha(readFileSync(BINARY)).toString('hex')!==BIN_SHA)throw Error('unreviewed sandbox binary');
  const s=new Sandbox();s.directory=mkdtempSync(join(tmpdir(),'mh-near-real-sandbox-'));s.home=join(s.directory,'node');s.port=await port();s.peerPort=await port();s.chainId='mh-synthetic-'+sha(Buffer.from(s.directory)).toString('hex').slice(0,16);
  const init=spawnSync(BINARY,['--home',s.home,'init','--fast'],{env:{PATH:'/usr/bin:/bin:/opt/homebrew/bin'},encoding:'utf8'});if(init.status!==0)throw Error('sandbox init failed: '+init.stderr);
  const config=JSON.parse(readFileSync(join(s.home,'config.json')));if(options.retainHistory===true)config.gc_num_epochs_to_keep=10000;config.rpc.addr=`127.0.0.1:${s.port}`;config.rpc.cors_allowed_origins=[];config.rpc.prometheus_addr=null;config.telemetry.endpoints=[];config.network.addr=`127.0.0.1:${s.peerPort}`;config.network.boot_nodes='';config.network.trusted_stun_servers=[];config.network.public_addrs=[];config.network.tier1.enable_inbound=false;config.network.tier1.enable_outbound=false;config.network.experimental.inbound_disabled=true;config.network.experimental.network_config_overrides.outbound_disabled=true;
  writeFileSync(join(s.home,'config.json'),JSON.stringify(config));
  const genesis=JSON.parse(readFileSync(join(s.home,'genesis.json')));genesis.chain_id=s.chainId;
  for(const id of ['synthetic','merchant','othermerchant']){
   const balance=10n**31n;genesis.total_supply=(BigInt(genesis.total_supply)+balance).toString();
   genesis.records.push({Account:{account_id:id,account:{amount:balance.toString(),locked:'0',code_hash:'11111111111111111111111111111111',storage_usage:182}}});
   genesis.records.push({AccessKey:{account_id:id,public_key:key(id).publicKey,access_key:{nonce:0,permission:'FullAccess'}}});
  }
  writeFileSync(join(s.home,'genesis.json'),JSON.stringify(genesis));s.rpc=new LocalNear(s.port,s.chainId);try{await s.start();return s;}catch(e){await s.cleanup();throw e;}
 }
 async start(){this.logfd=openSync(join(this.directory,'node.log'),'a');this.process=spawn(BINARY,['--home',this.home,'run'],{env:{PATH:'/usr/bin:/bin:/opt/homebrew/bin',RUST_LOG:'warn'},stdio:['ignore',this.logfd,this.logfd]});for(let i=0;i<160;i++){if(this.process.exitCode!==null||this.process.signalCode!==null)throw Error('sandbox exited: '+readFileSync(join(this.directory,'node.log'),'utf8').slice(-4000));try{await this.rpc.verify();return;}catch{}await pause(125);}throw Error('local sandbox startup timed out');}
 async stop(){if(!this.process)return;const p=this.process;if(p.exitCode===null&&p.signalCode===null){p.kill('SIGTERM');for(let i=0;i<50&&p.exitCode===null&&p.signalCode===null;i++)await pause(100);if(p.exitCode===null&&p.signalCode===null){const ended=new Promise(r=>p.once('exit',r));p.kill('SIGKILL');await ended;}}closeSync(this.logfd);this.process=null;}
 async restart(){await this.stop();await this.start();}
 async cleanup(){await this.stop();rmSync(this.directory,{recursive:true,force:true});}
 async account(name,wasm=null,init=null){if(!name.endsWith('.synthetic'))throw Error('synthetic account suffix required');let existing;try{existing=await this.rpc.rpc('query',{request_type:'view_account',account_id:name,finality:'final'});}catch(e){if(!e.message.includes('UNKNOWN_ACCOUNT'))throw e;}if(existing){await this.rpc.rpc('query',{request_type:'view_access_key',account_id:name,public_key:key(name).publicKey,finality:'final'});const expected=wasm?base58(sha(readFileSync(wasm))):'11111111111111111111111111111111';if(existing.code_hash!==expected)throw Error('existing synthetic account code mismatch');return null;}const list=[actions.create(),actions.transfer(10n**26n),actions.addKey(name)];if(wasm)list.push(actions.deploy(readFileSync(wasm)),actions.call('new',init||{}));return this.rpc.send('synthetic',name,list);}
 async bootstrap(){const target=resolve(ROOT,'../contract/target/wasm32-unknown-unknown/release');for(const a of ['alice','bob','agent','intruder','resolver'])await this.account(a+'.synthetic');await this.account('treasury.synthetic',join(target,'multihopper_near_policy_research.wasm'));await this.account('usd.synthetic',join(target,'multihopper_synthetic_token_fixture.wasm'),{symbol:'SYNTH-USD'});await this.account('native.synthetic',join(target,'multihopper_synthetic_token_fixture.wasm'),{symbol:'SYNTH-NATIVE'});}
}
