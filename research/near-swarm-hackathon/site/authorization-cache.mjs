// Memory-only reuse of the exact wallet-run scope; never renew a signature.
export function authorizationCache(now=Date.now){
  let saved;
  const key=scope=>JSON.stringify([scope.owner,scope.id,scope.action,scope.mode,scope.invoice,scope.extra]);
  return {
    clear(){saved=undefined;},
    async get(scope,sign){
      if(scope.action!=='wallet-run')return sign();
      if(saved?.key===key(scope)&&saved.body.expires>now()+30000)return {...saved.body};
      saved=undefined;
      const body=await sign();
      if(key(body)!==key(scope)||!body.signature||body.expires<=now())throw Error('Authorization does not match this invoice.');
      saved={key:key(scope),body:{...body}};
      return {...body};
    }
  };
}
