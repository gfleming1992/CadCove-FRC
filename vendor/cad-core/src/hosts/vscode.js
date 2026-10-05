// VS Code webview adapter. The privileged API stays private to this module.
export function createVSCodeHost(config) {
  const api=acquireVsCodeApi(), pending=new Map(), listeners=new Set();let serial=0,wasm;
  window.addEventListener('message',({data})=>{
    if(data?.event==='configuration-changed'){window.dispatchEvent(new Event('cad-configuration-changed'));return;}
    if(data?.event==='source-changed'){for(const fn of listeners)fn();return;}
    const task=pending.get(data?.id);if(!task)return;
    pending.delete(data.id);clearTimeout(task.timer);
    data.error?task.reject(Error(data.error)):task.resolve(data.result);
  });
  function request(method,args={}) {
    const id=++serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Editor request timed out: ${method}`));},60000);
      pending.set(id,{resolve,reject,timer});api.postMessage({id,method,args});
    });
  }
  return {
    entry:config.entry,
    readSources:()=>request('sources'),
    compile:(revision)=>request('compile',{revision}),
    wasm:()=>wasm??=(async()=>{const response=await fetch(config.wasm);if(!response.ok)throw Error('Cannot load OCCT WASM');return response.arrayBuffer();})(),
    async createWorker(){
      const response=await fetch(config.worker);if(!response.ok)throw Error('Cannot load CAD worker');
      const script=await response.text();
      const url=URL.createObjectURL(new Blob([`self.__instantcadModuleURL=${JSON.stringify(config.worker)};\n`,script],{type:'text/javascript'}));
      const worker=new Worker(url);const terminate=worker.terminate.bind(worker);worker.terminate=()=>{URL.revokeObjectURL(url);terminate();};return worker;
    },
    async readAsset(path){
      const url=await request('asset-url',{path});
      const response=await fetch(url);if(!response.ok)throw Error(`Cannot read ${path}`);
      return response.arrayBuffer();
    },
    async cache(){
      const result=await request('cache');
      if(!result)return null;
      const response=await fetch(result.url);if(!response.ok)return null;
      return {...result,bytes:await response.arrayBuffer()};
    },
    async writeArtifact(name,value){
      const bytes=typeof value==='string'?new TextEncoder().encode(value):value instanceof Blob?new Uint8Array(await value.arrayBuffer()):new Uint8Array(value);
      const token=await request('write-start',{name,size:bytes.byteLength});
      try{
        for(let offset=0;offset<bytes.length;offset+=192*1024){
          const chunk=bytes.subarray(offset,offset+192*1024);
          let text='';for(let i=0;i<chunk.length;i+=8192)text+=String.fromCharCode(...chunk.subarray(i,i+8192));
          await request('write-chunk',{token,offset,base64:btoa(text)});
        }
        await request('write-end',{token});
      }catch(error){await request('write-abort',{token}).catch(()=>{});throw error;}
    },
    watch(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    report:state=>request('report',{state}),
    reveal:()=>request('reveal'),
    state:()=>api.getState(),
    saveState:value=>api.setState(value),
    dispose(){for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Editor view closed'));}pending.clear();listeners.clear();},
  };
}
