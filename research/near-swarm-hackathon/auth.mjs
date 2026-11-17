import {createPublicKey, randomBytes, verify} from 'node:crypto';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function decode58(value) {
  if (typeof value !== 'string' || value.length > 50) throw Error('Invalid wallet');
  let n = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw Error('Invalid wallet');
    n = n * 58n + BigInt(digit);
  }
  const bytes = [];
  while (n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const char of value) { if (char !== '1') break; bytes.unshift(0); }
  if (bytes.length !== 32) throw Error('Invalid wallet');
  return Buffer.from(bytes);
}

export class WalletSessions {
  constructor({origin='http://127.0.0.1',now=Date.now,maxPending=1024,maxSessions=1024}={}) {
    const u=new URL(origin);
    const local=u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname);
    if(!(local || u.protocol==='https:') || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw Error('Valid login origin required');
    if(!Number.isSafeInteger(maxPending)||maxPending<1||!Number.isSafeInteger(maxSessions)||maxSessions<1) throw Error('Invalid session capacity');
    this.origin=u.origin;this.now=now;this.maxPending=maxPending;this.maxSessions=maxSessions;
    this.challenges = new Map(); this.sessions = new Map();
  }
  prune(map) { const t=this.now(); for(const [key,entry] of map)if(entry.expires<=t)map.delete(key); }
  challenge(address) {
    decode58(address);
    this.prune(this.challenges);
    if(this.challenges.size>=this.maxPending)throw Error('Too many pending wallet challenges');
    const nonce = randomBytes(32).toString('hex');
    const expires=this.now()+120000;
    const message = `MultiHopper synthetic demo login\nOrigin: ${this.origin}\nWallet: ${address}\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}`;
    this.challenges.set(nonce, {address, message, expires});
    return {nonce, message};
  }
  confirm(address, nonce, signature) {
    const entry = this.challenges.get(nonce);
    this.challenges.delete(nonce);
    if (!entry || entry.address !== address || entry.expires <= this.now()) throw Error('Challenge expired or invalid');
    const pubkey = createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),decode58(address)]),format:'der',type:'spki'});
    if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature) ||
        !verify(null,Buffer.from(entry.message),pubkey,Buffer.from(signature,'hex'))) throw Error('Invalid wallet signature');
    this.prune(this.sessions);
    if(this.sessions.size>=this.maxSessions)throw Error('Too many wallet sessions');
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token,{address,expires:this.now()+3600000});
    return token;
  }
  owner(token) {
    const session=this.sessions.get(token);
    if (!session || session.expires <= this.now()) {this.sessions.delete(token);throw Error('Wallet session required');}
    return session.address;
  }
}
