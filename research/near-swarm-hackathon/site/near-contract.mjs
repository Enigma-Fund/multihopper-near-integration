import {fromBase58} from './orders.mjs';
import {hashHex} from './near-job.mjs';

const nearEncoder = new TextEncoder();
const nearDecode = bytes => new TextDecoder().decode(bytes);
export const NEAR_JOB_STORAGE = '10000000000000000000000';
export const NEAR_INVOICE_STORAGE = '20000000000000000000000';
const nearBytes64 = bytes => btoa(String.fromCharCode(...bytes));
const nearUn64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export async function jobTermsHash(origin, body, job) {
  return hashHex(JSON.stringify(['multihopper-swarm-job-v1', origin, body.nearOwner,
    body.nearJobId, body.owner, body.id, job.recipient, job.budget, job.cap, 'solana:mainnet', 'native SOL']));
}
export function settlementStatement(network, contract, receipt) {
  return JSON.stringify(['multihopper-swarm-settlement-v1', network, contract,
    receipt.job_key, receipt.invoice_key, receipt.outcome, receipt.credited, receipt.evidence_hash]);
}
function nearJoin(parts) {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
}
function nearInteger(value, size) {
  let n = BigInt(value);
  if (n < 0n || n >= 1n << BigInt(size * 8)) throw Error('NEAR transaction nearInteger out of range');
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) { bytes[i] = Number(n & 255n); n >>= 8n; }
  return bytes;
}
function nearVector(bytes) { return nearJoin([nearInteger(bytes.length, 4), bytes]); }
const nearString = value => nearVector(nearEncoder.encode(value));

export function unsignedNearCall({signer, publicKey, nonce, blockHash, contract, method, args, deposit}) {
  if (!/^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(signer) ||
      !/^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(contract) ||
      !publicKey.startsWith('ed25519:')) throw Error('Invalid NEAR transaction accounts');
  const call = nearJoin([Uint8Array.of(2), nearString(method), nearVector(nearEncoder.encode(JSON.stringify(args))),
    nearInteger('30000000000000', 8), nearInteger(deposit, 16)]);
  return nearBytes64(nearJoin([nearString(signer), Uint8Array.of(0), fromBase58(publicKey.slice(8), 32),
    nearInteger(nonce, 8), nearString(contract), fromBase58(blockHash, 32), nearInteger(1, 4), call]));
}

export function nearContractServices(env, rpc) {
  const contract = env.SWARM_NEAR_CONTRACT;
  if (!contract) return undefined;
  if (!/^[0-9a-f]{64}$/.test(contract) && !/^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*\.near$/.test(contract)) throw Error('Invalid NEAR contract configuration');
  fromBase58(env.SWARM_NEAR_CODE_HASH, 32);
  const endpoint = 'https://rpc.mainnet.near.org';
  let verified;
  async function check() {
    if (!verified) verified = (async () => {
      if ((await rpc(endpoint, 'status', [])).chain_id !== 'mainnet') throw Error('Unexpected NEAR network');
      const account = await rpc(endpoint, 'query', {request_type: 'view_account', account_id: contract, finality: 'final'});
      if (account.code_hash !== env.SWARM_NEAR_CODE_HASH) throw Error('The NEAR contract code changed');
      const configuration = await read('configuration', {});
      if (configuration.network !== 'mainnet' || configuration.publisher !== env.SWARM_NEAR_PUBLISHER_KEY ||
          configuration.job_storage !== NEAR_JOB_STORAGE || configuration.invoice_storage !== NEAR_INVOICE_STORAGE) {
        throw Error('NEAR contract configuration does not match this workspace');
      }
      return configuration;
    })();
    return verified;
  }
  async function read(method, args) {
    const response = await rpc(endpoint, 'query', {request_type: 'call_function', account_id: contract,
      method_name: method, args_base64: nearBytes64(nearEncoder.encode(JSON.stringify(args))), finality: 'final'});
    fromBase58(response.block_hash, 32);
    return JSON.parse(nearDecode(Uint8Array.from(response.result)));
  }
  return {
    contract,
    async readiness() {
      const configuration = await check();
      if (!env.SWARM_NEAR_PUBLISHER_PRIVATE_KEY) throw Error('NEAR settlement signing is unavailable');
      const key = await crypto.subtle.importKey('pkcs8', nearUn64(env.SWARM_NEAR_PUBLISHER_PRIVATE_KEY), 'Ed25519', false, ['sign']);
      const publicKey = await crypto.subtle.importKey('raw', nearUn64(env.SWARM_NEAR_PUBLISHER_KEY), 'Ed25519', false, ['verify']);
      const challenge = nearEncoder.encode('multihopper-swarm-readiness-v1:'+contract);
      if (!await crypto.subtle.verify('Ed25519', publicKey, await crypto.subtle.sign('Ed25519', key, challenge), challenge)) throw Error('NEAR publisher key mismatch');
      return configuration;
    },
    async view(method, args) { await check(); return read(method, args); },
    async verifyOperation(hash, signer, method, expected) {
      fromBase58(hash, 32);
      await check();
      const receipt = await rpc(endpoint, 'tx', {tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL'});
      const tx = receipt.transaction;
      const call = tx?.actions?.[0]?.FunctionCall;
      if (receipt.final_execution_status !== 'FINAL' || tx?.hash !== hash || tx.signer_id !== signer ||
          tx.receiver_id !== contract || tx.actions.length !== 1 || call?.method_name !== method ||
          !Object.hasOwn(receipt.status ?? {}, 'SuccessValue') ||
          !receipt.receipts_outcome?.length || receipt.receipts_outcome.some(r => Object.hasOwn(r.outcome?.status ?? {}, 'Failure'))) {
        throw Error('The NEAR transaction is not a finalized successful operation for this job');
      }
      const args = JSON.parse(nearDecode(nearUn64(call.args)));
      if (Object.entries(expected).some(([key, value]) => args[key] !== value)) throw Error('The NEAR transaction belongs to different payment terms');
      return {hash, contract, method, finalized: true};
    },
    async prepare(signer, publicKey, method, args, deposit) {
      await check();
      const access = await rpc(endpoint, 'query', {request_type: 'view_access_key', account_id: signer,
        public_key: publicKey, finality: 'final'});
      if (access.permission !== 'FullAccess' || !Number.isSafeInteger(access.nonce)) throw Error('A full-access NEAR wallet must approve this operation');
      return {status: 'near-approval-required', contract, method, args, deposit,
        transaction: unsignedNearCall({signer, publicKey, nonce: BigInt(access.nonce) + 1n,
          blockHash: access.block_hash, contract, method, args, deposit})};
    },
    async attest(receipt) {
      await check();
      if (!env.SWARM_NEAR_PUBLISHER_PRIVATE_KEY) throw Error('NEAR settlement signing is unavailable');
      const privateKey = await crypto.subtle.importKey('pkcs8', nearUn64(env.SWARM_NEAR_PUBLISHER_PRIVATE_KEY), 'Ed25519', false, ['sign']);
      const signature = nearBytes64(new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey,
        nearEncoder.encode(settlementStatement('mainnet', contract, receipt)))));
      const publicKey = await crypto.subtle.importKey('raw', nearUn64(env.SWARM_NEAR_PUBLISHER_KEY), 'Ed25519', false, ['verify']);
      if (!await crypto.subtle.verify('Ed25519', publicKey, nearUn64(signature), nearEncoder.encode(settlementStatement('mainnet', contract, receipt)))) {
        throw Error('NEAR settlement signing key does not match the contract');
      }
      return {...receipt, signature};
    }
  };
}

export async function requireNearJob(near, origin, body, job, jobKey) {
  const state = await near.view('get_job', {job_key: jobKey});
  const terms = await jobTermsHash(origin, body, job);
  if (state && (state.owner !== body.nearOwner || state.terms_hash !== terms ||
      state.budget !== job.budget || state.per_payment !== job.cap)) throw Error('The on-chain NEAR job differs from the signed work order');
  return state;
}

export async function requireNearInvoice(near, jobKey, row) {
  const invoice = await near.view('get_invoice', {job_key: jobKey, invoice_key: row.external_id});
  if (invoice && (invoice.job_key !== jobKey || invoice.amount !== row.amount || invoice.minimum !== row.minimum)) {
    throw Error('The on-chain NEAR invoice differs from the signed payment');
  }
  return invoice;
}
