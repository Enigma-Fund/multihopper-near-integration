// Public-data-only reverse attribution. No access to job manifests, provider state or truth labels.
import {readFileSync,writeFileSync} from 'node:fs';
export function reverse(publicHistory){
 const edges=publicHistory.transfers;
 return edges.map(target=>{const roots=new Set(),stack=new Set();let ambiguous=false;
  function visit(account,before){const tag=account+':'+before;if(stack.has(tag)){ambiguous=true;return;}stack.add(tag);
   const incoming=edges.filter(x=>x.token===target.token&&x.to===account&&x.height<=before);
   if(!incoming.length){roots.add(account);stack.delete(tag);return;}
   for(const p of incoming)visit(p.from,p.height-1);stack.delete(tag);
  }
  visit(target.from,target.height);
  return {transaction:target.transaction,destination:target.to,candidates:[...roots].sort(),unique:roots.size===1&&!ambiguous};
 });
}
if(process.argv[1]?.endsWith('/observer.mjs')){const result=reverse(JSON.parse(readFileSync(process.argv[2])));writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');}
