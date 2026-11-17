import {createHash} from 'node:crypto';

// Server-only adapter. URL and key are held by the operator, never supplied by browsers.
// It accepts only test keys while synthetic execution is the supported mode.
export function createSolanaReader({baseUrl,apiKey,fetchImpl=fetch}) {
  const base=new URL(baseUrl);
  if (base.protocol !== 'https:' && !(['127.0.0.1','localhost'].includes(base.hostname) && base.protocol === 'http:')) throw Error('HTTPS API URL required');
  if (base.username || base.password || base.search || base.hash) throw Error('Invalid API URL');
  if (typeof apiKey !== 'string' || !apiKey.startsWith('mh_test_')) throw Error('A MultiHopper test API key is required');
  async function getTransfer(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Error('Invalid transfer ID');
    const endpoint=new URL(base);
    endpoint.pathname=base.pathname.replace(/\/$/,'')+'/transfers/'+encodeURIComponent(id);
    const response=await fetchImpl(endpoint,{headers:{'x-api-key':apiKey,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('Transfer lookup failed');
    const text=await response.text();
    if (text.length > 100000) throw Error('Transfer response too large');
    return JSON.parse(text);
  }
  return {getTransfer,configurationId:createHash('sha256').update(base.origin+base.pathname).digest('hex').slice(0,16)};
}

