// Shared worker lifecycle. Hosts own worker creation and optional asset I/O;
// no folder picker, service worker, VS Code API, or disk cache lives here.
export class CadClient {
  constructor({createWorker, readAsset, onProgress = () => {}, onCancel = () => {}}) {
    Object.assign(this,{createWorker,readAsset,onProgress,onCancel});
    this.pending=new Map(); this.serial=0; this.generation=0;
  }
  get loaded() { return !!this.worker; }
  async ensureWorker() {
    if(this.worker)return this.worker;
    if(!this.starting){
      const epoch=this.generation;
      this.starting=this.createWorker().then(worker=>{
        if(epoch!==this.generation){worker.terminate();throw Error('Build canceled');}
        this.worker=worker;
        worker.onmessage=event=>this.receive(worker,event.data);
        worker.onerror=event=>this.cancel(event.message||'CAD worker failed');
        return worker;
      }).finally(()=>{if(epoch===this.generation)this.starting=undefined;});
    }
    return this.starting;
  }
  async receive(worker,data) {
    if(data.kind==='asset-request') {
      try {
        const bytes=await this.readAsset(data.path,data.context);
        if(this.worker===worker)worker.postMessage({kind:'asset-response',requestId:data.requestId,bytes},[bytes]);
      } catch(error) {if(this.worker===worker)worker.postMessage({kind:'asset-response',requestId:data.requestId,error:error.message});}
      return;
    }
    const task=this.pending.get(data.id);
    if(!task)return;
    if(data.progress){this.onProgress(data.progress);return;}
    if(data.result?.transport){
      const t=data.result.transport;
      data.result.timings.dispatchToWorkerMs=t.workerStartEpochMs-task.sentEpochMs;
      data.result.timings.resultReturnMs=performance.timeOrigin+performance.now()-t.workerDoneEpochMs;
      delete data.result.transport;
    }
    if(data.ok && task.kind==='build') {
      try {
        const old=new Map((this.scene?.parts??[]).filter(p=>p.geometryKey).map(p=>[p.geometryKey,p]));
        data.result.parts=data.result.parts.map(p=>{
          if(!p.reuse)return p;
          const cached=old.get(p.geometryKey);
          if(!cached)throw Error('Component cache base is missing; rebuild the scene');
          return {...cached,id:p.id,name:p.name,color:p.color};
        });
        this.scene=data.result;
      }catch(error){data.ok=false;data.error=error.message;}
    }
    clearTimeout(task.timer);this.pending.delete(data.id);
    data.ok?task.resolve(data.result):task.reject(Error(data.error));
  }
  async request(kind,body={},timeout=kind==='build'?300000:180000) {
    // Exact geometry can be cold after a mesh-only hot swap. Hydration gets a
    // build-sized budget; user inspection code keeps its short execution limit.
    if(kind==='inspect'||kind==='export')await this.request('materialize',{},300000);
    const epoch=this.generation,worker=await this.ensureWorker();
    if(epoch!==this.generation)throw Error('Build canceled');
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.cancel('CAD execution timed out; the last successful scene is preserved'),timeout);
      this.pending.set(id,{resolve,reject,timer,kind,sentEpochMs:performance.timeOrigin+performance.now()});
      try{
        const cache=kind==='build' ? {
          knownGeometryKeys:(this.scene?.parts??[]).map(p=>p.geometryKey).filter(Boolean),
          ...(!this.seeded && this.scene ? {meshSeed:this.scene.parts} : {}),
        } : {};
        worker.postMessage({id,kind,...body,...cache});
        if(kind==='build')this.seeded=true;
      }catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  cancel(reason='Build canceled') {
    this.generation++;this.worker?.terminate();this.worker=undefined;this.starting=undefined;
    this.seeded=false;
    for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(Error(reason));}
    this.pending.clear();this.onCancel(reason);
  }
  dispose(){this.cancel('CAD session closed');}
}
