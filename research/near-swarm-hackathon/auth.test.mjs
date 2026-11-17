import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {WalletSessions} from './auth.mjs';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){let n=BigInt('0x'+bytes.toString('hex')),out='';while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}for(const b of bytes){if(b)break;out='1'+out;}return out;}
function wallet(){const pair=generateKeyPairSync('ed25519');return {pair,address:base58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32))};}
function proof(w,c){return sign(null,Buffer.from(c.message),w.pair.privateKey).toString('hex');}
test('challenges bind the origin, expire and cannot be replayed',()=>{
 let now=1000000;const auth=new WalletSessions({origin:'https://business.example',now:()=>now});const w=wallet();let c=auth.challenge(w.address);
 assert.match(c.message,/Origin: https:\/\/business\.example/);const sig=proof(w,c);const token=auth.confirm(w.address,c.nonce,sig);assert.equal(auth.owner(token),w.address);assert.throws(()=>auth.confirm(w.address,c.nonce,sig),/expired or invalid/);
 c=auth.challenge(w.address);now+=120000;assert.throws(()=>auth.confirm(w.address,c.nonce,proof(w,c)),/expired or invalid/);now+=3600000;assert.throws(()=>auth.owner(token),/session required/);
});
test('pending challenges and sessions are bounded and expired entries are pruned',()=>{
 let now=1000000;const auth=new WalletSessions({origin:'http://127.0.0.1:18990',now:()=>now,maxPending:1,maxSessions:1});const w=wallet(),v=wallet();let c=auth.challenge(w.address);assert.throws(()=>auth.challenge(v.address),/Too many pending/);auth.confirm(w.address,c.nonce,proof(w,c));c=auth.challenge(v.address);assert.throws(()=>auth.confirm(v.address,c.nonce,proof(v,c)),/Too many wallet sessions/);now+=3600000;c=auth.challenge(v.address);assert.ok(auth.confirm(v.address,c.nonce,proof(v,c)));
 assert.throws(()=>new WalletSessions({origin:'http://example.com'}),/origin/);assert.throws(()=>new WalletSessions({origin:'https://example.com/path'}),/origin/);
});
