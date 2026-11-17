// Disposable synthetic chain adapter for local development. No real funds.
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Sandbox} from '../hub/near/sandbox/node.mjs';
import {ProviderClient} from '../hub/near/ordinary/client.mjs';
import {SwarmJobs} from '../hub/near/swarm/jobs.mjs';

export class LocalNearJobs {
  static async start() {
    const instance=new LocalNearJobs();
    instance.sandbox=await Sandbox.create();
    try {
      const s=instance.sandbox;
      await s.bootstrap();
      await s.account('researcher.synthetic');
      await s.account('reviewer.synthetic');
      const root=fileURLToPath(new URL('../hub/near/',import.meta.url));
      const wasm=resolve(root,'contract/target/wasm32-unknown-unknown/release/multihopper_ordinary_token_fixture.wasm');
      await s.account('ordinaryusd.synthetic',wasm,{symbol:'SYNTH-USD'});
      const codeHashes={};
      for(const account_id of ['treasury.synthetic','ordinaryusd.synthetic']) {
        codeHashes[account_id]=(await s.rpc.rpc('query',{request_type:'view_account',account_id,finality:'final'})).code_hash;
      }
      const config=join(s.directory,'provider.json');
      writeFileSync(config,JSON.stringify({directory:join(s.directory,'private-provider'),port:s.port,chainId:s.chainId,codeHashes}));
      instance.provider=new ProviderClient(config);
      await instance.provider.ready;
      instance.jobs=new SwarmJobs(join(s.directory,'jobs'),s.rpc,instance.provider);
      instance.owners=new Map();
      instance.jobKeys=new Map();
      return instance;
    } catch(error) {
      if(instance.provider) await instance.provider.close();
      await instance.sandbox.cleanup();
      throw error;
    }
  }
  owner(address) {
    if(!this.owners.has(address)) {
      if(this.owners.size >= 2) throw Error('Local demo supports two distinct customers');
      this.owners.set(address,this.owners.size ? 'bob.synthetic' : 'alice.synthetic');
    }
    return this.owners.get(address);
  }
  async create(address,id,budget,limit) {
    const owner=this.owner(address);
    const jobId=address+':'+id;
    if(this.jobKeys.has(jobId)) throw Error('Job ID already exists or requires reconciliation');
    // Reserve before any asynchronous chain operation to prevent double minting.
    const record={status:'creating',key:null};
    this.jobKeys.set(jobId,record);
    try {
    const now=Math.floor(Date.parse((await this.sandbox.rpc.verify()).sync_info.latest_block_time)/1000);
    const job=await this.jobs.create({owner,jobId:id,title:'Synthetic agent job',budget,expires:now+3600,
      slots:[{id:'research',agent:'researcher.synthetic',recipient:'merchant',allocation:budget,perPayment:limit}]},owner);
    record.key=job.key;
    record.status='funding';
    await this.sandbox.rpc.call('synthetic','ordinaryusd.synthetic','mint',{account_id:owner,amount:budget});
    await this.jobs.fund(job.key,owner);
    record.status='active';
    return this.snapshot(address,id);
    } catch(error) {
      record.status='unknown';
      throw error;
    }
  }
  async pay(address,id,invoiceId,amount) {
    const record=this.jobKeys.get(address+':'+id);
    if(!record || record.status!=='active') throw Error('Active customer job required');
    await this.jobs.pay({jobKey:record.key,slotId:'research',invoiceId,amount,actor:'researcher.synthetic'});
    return this.snapshot(address,id);
  }
  async fail(address,id) {
    const record=this.jobKeys.get(address+':'+id);
    if(!record || !['active','recovering','recovered'].includes(record.status)) throw Error('Customer job requires reconciliation');
    record.status='recovering';
    await this.jobs.finish(record.key,this.owner(address));
    record.status='recovered';
    return this.snapshot(address,id);
  }
  async snapshot(address,id) {
    const j=await this.jobs.snapshot(this.jobKeys.get(address+':'+id).key);
    return {id,budget:j.budget,spent:j.spent,remaining:j.principal,returned:j.refunded,status:j.status};
  }
  async close() {
    if(this.jobs)this.jobs.close();
    if(this.provider)await this.provider.close();
    if(this.sandbox)await this.sandbox.cleanup();
  }
}

