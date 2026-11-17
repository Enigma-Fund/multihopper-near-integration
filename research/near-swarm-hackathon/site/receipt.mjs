import {fromBase58} from './orders.mjs';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const ROUTER_PROGRAM = '3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh';
const verifyInstruction = [112,252,200,234,89,169,208,236];

// Restrict evidence to finalized, successful top-level program instructions.
// Requiring an exact route ID prevents presenting another route's proof as this one.
export async function screeningReceipt(rpc, signature, routeId) {
  fromBase58(signature,64);
  if (typeof routeId !== 'string' || !/^[0-9a-f]{64}$/.test(routeId)) throw Error('Enter the 32-byte on-chain route ID in hex');
  if (await rpc('getGenesisHash',[]) !== MAINNET_GENESIS) throw Error('Unexpected Solana network');
  const tx = await rpc('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  if (!Number.isSafeInteger(tx?.slot) || tx.meta?.err !== null || tx.transaction?.signatures?.[0] !== signature) throw Error('A successful finalized transaction is required');
  const message = tx.transaction.message;
  const accounts = [...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  for (const ix of message.instructions) {
    if (accounts[ix.programIdIndex] !== ROUTER_PROGRAM || ix.accounts?.length < 6) continue;
    let data;
    try { data=fromBase58(ix.data,40); } catch { continue; }
    const hex = Array.from(data.subarray(8),b=>b.toString(16).padStart(2,'0')).join('');
    if (hex===routeId && verifyInstruction.every((v,i)=>v===data[i])) return {routeId,signature,slot:tx.slot,screening:'MultiHopper route checkpoint verified',coverage:'Route creator and ordered hop recipients',issuer:'MultiHopper screener'};
  }
  throw Error('This transaction contains no matching route screening checkpoint');
}
