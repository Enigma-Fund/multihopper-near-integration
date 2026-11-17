import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSolanaReader} from './solana-reader.mjs';
test('status lookup binds the configured API and uses test credentials without following redirects',async()=>{
 let seen;
 const reader=createSolanaReader({baseUrl:'https://api.example/api/v1',apiKey:'mh_test_synthetic',fetchImpl:async(url,options)=>{
  seen={url:String(url),options};
  return new Response(JSON.stringify({status:'completed'}),{status:200});
 }});
 assert.deepEqual(await reader.getTransfer('abc-123'),{status:'completed'});
 assert.equal(seen.url,'https://api.example/api/v1/transfers/abc-123');
 assert.equal(seen.options.redirect,'error');
 assert.equal(seen.options.headers['x-api-key'],'mh_test_synthetic');
 await assert.rejects(()=>reader.getTransfer('../keys'),/Invalid/);
 assert.throws(()=>createSolanaReader({baseUrl:'https://api.example',apiKey:'mh_live_secret'}),/test API/);
});

