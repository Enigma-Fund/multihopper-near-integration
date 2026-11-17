import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

// A durable, single-host test journal. An uncertain submission is never
// automatically replayed. Confirmation here means an API response was recorded,
// not that an on-chain payment reached finality.
function canonical(v){
 if(v===null || typeof v==='string' || typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number' && Number.isFinite(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(typeof v==='object' && Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 throw Error('Unsupported operation data');
}
export class OperationJournal {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS operations (operation_key TEXT PRIMARY KEY, owner TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, response TEXT);');}
 close(){this.db.close();}
 async run({key,owner,method,path,body},send){
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(key)||typeof owner!=='string'||owner.length<1||owner.length>128)throw Error('Invalid operation identity');
  const digest=createHash('sha256').update(canonical({owner,method,path,body})).digest('hex');
  let entry;
  this.db.exec('BEGIN IMMEDIATE');
  try {
   entry=this.db.prepare('SELECT owner,digest,state,response FROM operations WHERE operation_key=?').get(key);
   if(entry){
    if(entry.owner!==owner || entry.digest!==digest)throw Error('Idempotency key conflicts with an earlier operation');
    if(entry.state!=='responded')throw Error('Operation outcome unknown; reconciliation required');
   } else {
    this.db.prepare('INSERT INTO operations(operation_key,owner,digest,state) VALUES(?,?,?,?)').run(key,owner,digest,'uncertain');
   }
   this.db.exec('COMMIT');
  } catch(error){this.db.exec('ROLLBACK');throw error;}
  if(entry)return JSON.parse(entry.response);
  const response=await send();
  const encoded=canonical(response);
  this.db.prepare("UPDATE operations SET state='responded',response=? WHERE operation_key=? AND state='uncertain'").run(encoded,key);
  return response;
 }
}
