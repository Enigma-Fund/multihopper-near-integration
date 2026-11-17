// Optional operator configuration; never supplied by the requesting website.
export function solanaRpcEndpoint(config){
  if(config==null)return 'https://api.mainnet.solana.com';
  const endpoint=new URL(config.url);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.hash||
     !['api.mainnet.solana.com','solana-rpc.publicnode.com','mainnet.helius-rpc.com'].includes(endpoint.hostname)||endpoint.port)throw Error('Unsupported local Solana connection');
  return endpoint.href;
}
