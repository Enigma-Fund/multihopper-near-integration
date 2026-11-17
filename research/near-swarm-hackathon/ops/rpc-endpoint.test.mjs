import {test} from 'node:test';
import assert from 'node:assert/strict';
import {solanaRpcEndpoint} from './rpc-endpoint.mjs';
test('the local wallet connection accepts only operator-configured approved HTTPS hosts',()=>{
 assert.equal(solanaRpcEndpoint(),'https://api.mainnet.solana.com');
 assert.equal(solanaRpcEndpoint({url:'https://mainnet.helius-rpc.com/?api-key=synthetic'}),'https://mainnet.helius-rpc.com/?api-key=synthetic');
 for(const url of ['http://mainnet.helius-rpc.com/','https://mainnet.helius-rpc.com.attacker.invalid/','https://user:pass@mainnet.helius-rpc.com/','https://mainnet.helius-rpc.com:9443/','file:///etc/passwd'])assert.throws(()=>solanaRpcEndpoint({url}));
});
