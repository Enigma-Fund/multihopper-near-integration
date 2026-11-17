export function checkWorkOrderMessage(text,origin,owner,now=Date.now()){
  const prefix='MultiHopper | Swarm for Hire\nSign a work order. This message cannot transfer funds.\nSite: '+origin+'\n';
  const lines=text.split('\n');
  if(!text.startsWith(prefix)||text.length>8000||lines.filter(l=>l.startsWith('Owner: ')).length!==1||
    !lines.includes('Owner: '+owner)||lines.filter(l=>l.startsWith('Expires: ')).length!==1||!lines.at(-1).startsWith('Expires: '))throw Error('Only this website’s signed work orders are supported');
  const expiry=Date.parse(lines.at(-1).slice(9));
  if(!Number.isSafeInteger(expiry)||expiry<=now||expiry>now+300000)throw Error('Work-order signature request expired');
}
