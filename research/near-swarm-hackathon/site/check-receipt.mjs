// Read-only receipt lookup using the same verifier as the hosted workspace.
import {lookupReceipt,publicReceiptEndpoints} from './receipt.mjs';

const [signature,routeId]=process.argv.slice(2);
if(!signature || !routeId) {
  console.error('Usage: node site/check-receipt.mjs TRANSACTION_SIGNATURE ROUTE_ID_HEX');
  process.exitCode=2;
} else {
  try {
    const rpc=process.env.SWARM_ARCHIVE_RPC;
    if(rpc && new URL(rpc).protocol!=='https:')throw Error('Archive RPC must use HTTPS');
    const endpoints=rpc ? [rpc,...publicReceiptEndpoints] : publicReceiptEndpoints;
    const receipt=await lookupReceipt(signature,routeId.toLowerCase(),endpoints);
    console.log(JSON.stringify(receipt,null,2));
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
