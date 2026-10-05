// Website-only service-worker module transport. The CAD core knows no routes.
export function createBrowserHost(assets) {
  let ready;
  const serviceWorker=()=> ready??=(async()=>{
    if(!('serviceWorker' in navigator))throw Error('Service workers require HTTPS or localhost.');
    await navigator.serviceWorker.register('/sw.js',{type:'module'});
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    return navigator.serviceWorker.controller;
  })();
  return {
    async createWorker(){await serviceWorker();return new Worker(assets.worker,{type:'module'});},
    serviceWorker,
    async warmShell(){(await serviceWorker()).postMessage({type:'cache-shell'});},
    modelModule(revision,entry){return `${location.origin}/__models/${revision}/${crypto.randomUUID()}/${entry.split('/').map(encodeURIComponent).join('/')}`;},
  };
}
