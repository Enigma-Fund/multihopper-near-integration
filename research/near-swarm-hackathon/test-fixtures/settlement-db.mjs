import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function store(){
 const sql=new DatabaseSync(':memory:');for(const file of ['schema.sql','settlement.sql'])sql.exec(readFileSync(new URL('../site/'+file,import.meta.url),'utf8'));
 return {prepare(query){return {bind(...args){const stmt=sql.prepare(query);return {run:()=>({meta:stmt.run(...args)}),first:()=>stmt.get(...args),all:()=>({results:stmt.all(...args)})};}};},
 async batch(list){sql.exec('BEGIN');try{const values=list.map(s=>s.run());sql.exec('COMMIT');return values;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
