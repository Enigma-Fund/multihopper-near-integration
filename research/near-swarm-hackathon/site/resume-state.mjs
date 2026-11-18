export const resumeFields=['recipient','job-id','budget','cap','near-owner','near-id','invoice','amount','minimum','extra'];
export function resumeStore(storage,key='swarm-workspace-v1'){
 const empty=()=>({active:null,jobs:{}});
 function read(){try{const x=JSON.parse(storage.getItem(key));return x?.jobs&&typeof x.jobs==='object'?x:empty();}catch{return empty();}}
 function clean(row){return {owner:typeof row.owner==='string'?row.owner:'',fields:Object.fromEntries(resumeFields.map(k=>[k,typeof row.fields?.[k]==='string'?row.fields[k].slice(0,512):'']))};}
 return {
  load(){const s=read();return s.active&&s.jobs[s.active]?{key:s.active,...clean(s.jobs[s.active])}:null;},
  list(){return Object.entries(read().jobs).map(([key,row])=>({key,...clean(row)}));},
  save(id,row){const s=read();s.active=id;s.jobs[id]=clean(row);storage.setItem(key,JSON.stringify(s));},
  select(id){const s=read();if(!Object.hasOwn(s.jobs,id))throw Error('Saved job not found');s.active=id;storage.setItem(key,JSON.stringify(s));return this.load();}
 };
}
