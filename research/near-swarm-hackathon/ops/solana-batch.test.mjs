import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {inspectSolanaBatch,packSolanaBatch} from './solana-batch.mjs';
import {base58} from './near-wire.mjs';
function identity(){const k=generateKeyPairSync('ed25519');return {...k,pub:k.publicKey.export({format:'der',type:'spki'}).subarray(-32)};}
function wire(owner,other){const data=Buffer.alloc(52);data.writeBigUInt64LE(10n,4);const msg=Buffer.concat([Buffer.from([2,0,1,3]),owner.pub,other.pub,Buffer.alloc(32),randomBytes(32),Buffer.from([1,2,2,0,1,52]),data]);return Buffer.concat([Buffer.of(2),Buffer.alloc(64),sign(null,msg,other.privateKey),msg]);}
test('one batch validates every co-signature, preserves them and rejects duplicates, tampering or another owner',()=>{
 const owner=identity(),a=wire(owner,identity()),b=wire(owner,identity()),address=base58(owner.pub),bytes=[a,b].map(x=>x.toString('base64'));
 const txs=inspectSolanaBatch(bytes,address),signatures=txs.map(tx=>sign(null,Buffer.from(tx.wire.slice(tx.start)),owner.privateKey));
 const packed=packSolanaBatch(txs,signatures);assert.equal(packed.length,2);
 assert.deepEqual(Buffer.from(packed[0],'base64').subarray(65,129),a.subarray(65,129));
 assert.throws(()=>inspectSolanaBatch([bytes[0],bytes[0]],address),/Duplicate/);
 assert.throws(()=>inspectSolanaBatch(bytes,base58(identity().pub)),/fee payer/);
 const damaged=Buffer.from(a);damaged[70]^=1;assert.throws(()=>inspectSolanaBatch([damaged.toString('base64')],address),/co-signature/);
 assert.throws(()=>packSolanaBatch(txs,signatures.slice(1)),/Incomplete/);
 assert.throws(()=>packSolanaBatch(txs,[signatures[1],signatures[0]]),/Invalid native/);
 assert.throws(()=>inspectSolanaBatch(packed,address),/Already-signed/);
});
