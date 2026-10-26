import {decodeScene} from '../core/mesh.js';
// VS Code webview adapter. The privileged API stays private to this module.
export function createVSCodeHost(config) {
  const api=acquireVsCodeApi(), pending=new Map(), listeners=new Set();let agentHandler;let serial=0,nativeScene,nativeLoaded=false;
  window.addEventListener('message',({data})=>{
    if(data?.agentRequest){Promise.resolve().then(()=>agentHandler?.(data.method,data.args)).then(result=>api.postMessage({agentReply:data.agentRequest,result}),error=>api.postMessage({agentReply:data.agentRequest,error:error.message}));return;}
    if(data?.event==='configuration-changed'){window.dispatchEvent(new Event('cad-configuration-changed'));return;}
    if(data?.event==='source-changed'){for(const fn of listeners)fn();return;}
    const task=pending.get(data?.id);if(!task)return;
    pending.delete(data.id);clearTimeout(task.timer);
    data.error?task.reject(Error(data.error)):task.resolve(data.result);
  });
  function request(method,args={}) {
    const id=++serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Editor request timed out: ${method}`));},method==='native-build'?360000:60000);
      pending.set(id,{resolve,reject,timer});api.postMessage({id,method,args});
    });
  }
  return {
    entry:config.entry,
    request,
    onAgentRequest:handler=>{agentHandler=handler;},
    get nativeLoaded(){return nativeLoaded;},
    async nativeBuild(revision){
      nativeLoaded=true;
      const result=await request('native-build',{revision});
      const response=await fetch(result.url);if(!response.ok)throw Error('Cannot load native mesh');
      const scene=decodeScene(await response.arrayBuffer());
      const previous=new Map((nativeScene?.parts??[]).map(p=>[p.geometryKey,p]));
      scene.parts=scene.parts.map(part=>{
        const old=previous.get(part.geometryKey);
        return old?{...part,positions:old.positions,normals:old.normals,indices:old.indices}:part;
      });
      nativeScene=scene;
      return {...scene,revision,timings:result.timings};
    },
    nativeInspect:code=>request('native-inspect',{code}),
    nativeCancel:()=>{nativeLoaded=false;return request('native-cancel');},
    readSources:()=>request('sources'),
    commitNativeScene:revision=>request('native-commit',{revision}),
    async cache(revision){
      const result=await request('cache');
      if(!result||(revision&&result.revision!==revision)||result.runtime!==config.runtime)return null;
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
