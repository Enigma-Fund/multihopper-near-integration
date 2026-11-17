// Coordinator-facing provider client: narrow requests and public results only.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
export class ProviderClient {
 constructor(config){this.outcomes=[];this.pending=new Map();this.next=0;this.child=spawn(process.execPath,[fileURLToPath(new URL('./service.mjs',import.meta.url)),config],{env:{PATH:'/usr/bin:/bin:/opt/homebrew/bin'},stdio:['pipe','pipe','pipe']});this.stderr='';this.child.stderr.on('data',b=>this.stderr+=b);
 this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
 this.lines=createInterface({input:this.child.stdout});this.lines.on('line',line=>{const m=JSON.parse(line);if(m.ready){this.resolveReady();return;}const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);if(m.result?.hash)this.outcomes.push({hash:m.result.hash,state:m.result.state});m.error?p.reject(Error(m.error)):p.resolve(m.result);});
 this.exited=new Promise(resolve=>this.child.on('exit',code=>{this.rejectReady(Error('provider exited'));for(const p of this.pending.values())p.reject(Error('provider interrupted'));this.pending.clear();resolve(code);}));
 this.child.on('error',e=>this.rejectReady(e));
 }
 async request(request){await this.ready;const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.child.stdin.write(JSON.stringify({id,request})+'\n');});}
 async close(){this.child.stdin.end();await this.exited;this.lines.close();}
}
