import {createPublicKey,verify} from 'node:crypto';
import {inspectWire} from '../site/wallet-bundle.mjs';
export function inspectSolanaBatch(transactions,owner){
  if(!Array.isArray(transactions)||!transactions.length||transactions.length>12)throw Error('Invalid wallet batch size');
  const seen=new Set();
  return transactions.map(encoded=>{
    const tx=inspectWire(encoded,owner),message=Buffer.from(tx.wire.slice(tx.start));
    if(tx.wire.slice(1,65).some(Boolean))throw Error('Already-signed owner transaction must be reconciled');
    const identity=message.toString('base64');if(seen.has(identity))throw Error('Duplicate transaction in wallet batch');seen.add(identity);
    for(let i=1;i<tx.count;i++){
      const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(tx.keys[i])]),format:'der',type:'spki'});
      if(!verify(null,message,key,tx.wire.slice(1+64*i,65+64*i)))throw Error('Invalid API co-signature');
    }
    return tx;
  });
}
export function packSolanaBatch(transactions,signatures){
  if(!Array.isArray(signatures)||signatures.length!==transactions.length)throw Error('Incomplete native signature batch');
  return transactions.map((tx,i)=>{
    const sig=Buffer.from(signatures[i]),key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(tx.keys[0])]),format:'der',type:'spki'});
    if(sig.length!==64||!verify(null,Buffer.from(tx.wire.slice(tx.start)),key,sig))throw Error('Invalid native batch signature');
    const wire=Buffer.from(tx.wire);sig.copy(wire,1);return wire.toString('base64');
  });
}
