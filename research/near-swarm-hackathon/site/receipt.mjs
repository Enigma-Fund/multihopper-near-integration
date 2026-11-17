import {fromBase58} from './orders.mjs';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const ROUTER_PROGRAM = '3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh';
const verifyInstruction = [112,252,200,234,89,169,208,236];
export class ReceiptUnavailable extends Error {}
export const publicReceiptEndpoints = ['https://api.mainnet.solana.com','https://solana-rpc.publicnode.com'];

export async function lookupReceipt(signature, routeId, endpoints = publicReceiptEndpoints, transport = fetch) {
  for (const endpoint of endpoints) {
    const rpc = async (method, params) => {
      try {
        const response = await transport(endpoint, {
          method:'POST', headers:{'content-type':'application/json'},
          body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
          credentials:'omit', referrerPolicy:'no-referrer', redirect:'manual', signal:AbortSignal.timeout(5000)
        });
        if (!response.ok) throw Error();
        const data = await response.json();
        if (data.error || data.id !== 1 || !Object.hasOwn(data,'result')) throw Error();
        return data.result;
      } catch { throw new ReceiptUnavailable(); }
    };
    try { return await screeningReceipt(rpc, signature, routeId); }
    catch (error) { if (!(error instanceof ReceiptUnavailable)) throw error; }
  }
  throw new ReceiptUnavailable('The Solana providers could not retrieve this finalized transaction. The screening result is unknown.');
}

// Restrict evidence to finalized, successful top-level program instructions.
// Requiring an exact route ID prevents presenting another route's proof as this one.
export async function screeningReceipt(rpc, signature, routeId) {
  fromBase58(signature,64);
  if (typeof routeId !== 'string' || !/^[0-9a-f]{64}$/.test(routeId)) throw Error('Enter the 32-byte on-chain route ID in hex');
  if (await rpc('getGenesisHash',[]) !== MAINNET_GENESIS) throw new ReceiptUnavailable('Unexpected Solana network');
  const tx = await rpc('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  if (!Number.isSafeInteger(tx?.slot) || !tx.meta || !Object.hasOwn(tx.meta,'err') || tx.transaction?.signatures?.[0] !== signature)
    throw new ReceiptUnavailable('The Solana provider could not supply this finalized transaction.');
  if (tx.meta.err !== null) throw Error('The transaction failed on Solana. It cannot verify this route.');
  const message = tx.transaction.message;
  const accounts = [...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  for (const ix of message.instructions) {
    if (accounts[ix.programIdIndex] !== ROUTER_PROGRAM || !Array.isArray(ix.accounts) || ix.accounts.length < 6) continue;
    let data;
    try { data=fromBase58(ix.data,40); } catch { continue; }
    const hex = Array.from(data.subarray(8),b=>b.toString(16).padStart(2,'0')).join('');
    if (hex===routeId && verifyInstruction.every((v,i)=>v===data[i])) return {routeId,signature,slot:tx.slot,screening:'MultiHopper route checkpoint verified',coverage:'Route creator and ordered hop recipients',issuer:'MultiHopper screener'};
  }
  throw Error('This transaction contains no matching route screening checkpoint');
}
