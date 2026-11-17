// A separate SQLite database holds the OS writer lock across asynchronous operations.
// Journal commits use another database, so intent remains durable before chain effects.
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
export class ProcessLease {
 constructor(directory,label){this.db=new DatabaseSync(join(directory,'process-lock.sqlite'));try{this.db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS guard(id INTEGER PRIMARY KEY);');}catch(e){this.db.close();this.db=null;throw Error(label+' already active or lease unavailable',{cause:e});}}
 close(){if(this.db){try{this.db.exec('ROLLBACK');}finally{this.db.close();this.db=null;}}}
}
