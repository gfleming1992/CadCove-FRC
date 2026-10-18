import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const nativeRuntimeIdentity='cadquery@2.6.1/ocp@7.8.1.1/native-mesh-v1';
export const nativeIdentityFor=worker=>nativeRuntimeIdentity+'/worker:'+createHash('sha256').update(readFileSync(worker)).update(readFileSync(path.join(path.dirname(worker),'geometry.py'))).digest('hex');

// One bounded, serialized process per open model; no Python on cached opens.
export class NativeCadClient {
  // Full STEP-heavy assemblies can exceed five minutes on Windows laptops.
  // Keep an explicit deadline; callers can still supply a shorter budget.
  constructor({python,worker,onLog=()=>{},timeout=process.platform==='win32'?900000:300000}){Object.assign(this,{python,worker,onLog,timeout});this.serial=0;this.pending=new Map();}
  start(){
    if(this.ready)return this.ready;
    const identity=nativeIdentityFor(this.worker);
    this.ready=new Promise((resolve,reject)=>{
      const child=this.child=spawn(this.python,['-u','-B',this.worker],{stdio:['pipe','pipe','pipe'],windowsHide:true});
      let ready=false;
      const timer=setTimeout(()=>{reject(Error('Native CAD startup timed out'));this.dispose();},30000);
      const fail=error=>{clearTimeout(timer);reject(error);if(this.child!==child)return;for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(error);}this.pending.clear();this.child=undefined;this.ready=undefined;};
      child.once('error',error=>fail(Error(`Cannot start CadQuery Python: ${error.message}. Configure instantcad.pythonPath and install src/native/requirements.txt.`)));
      child.once('exit',(code,signal)=>fail(Error(`Native CAD process exited (${signal??code})`)));
      child.stderr.on('data',chunk=>this.onLog(String(chunk).slice(0,16000)));
      createInterface({input:child.stdout}).on('line',line=>{
        try{
          const message=JSON.parse(line);
          if(message.ready){
            if(message.runtime!==identity)throw Error('Native CAD runtime version mismatch');
            ready=true;clearTimeout(timer);resolve(message);return;
          }
          if(!ready)throw Error(message.error??'Native CAD failed to initialize');
          const task=this.pending.get(message.id);if(!task)return;
          this.pending.delete(message.id);clearTimeout(task.timer);
          message.error?task.reject(Error(message.error)):task.resolve(message.result);
        }catch(error){fail(error);child.kill();}
      });
    });return this.ready;
  }
  async request(body){
    const ready=this.start(),child=this.child,startup=await ready;
    if(child!==this.child)throw Error('Native CAD canceled');
    if(this.pending.size)throw Error('A native CAD operation is already running');
    const id=++this.serial;
    const result=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Native CAD build timed out'));this.dispose();},this.timeout);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({...body,id})+'\n',error=>{if(error){this.pending.delete(id);clearTimeout(timer);reject(error);}});
    });
    return body.kind==='build'?{...result,timings:{...result.timings,workerStartupMs:startup.startupMs}}:result;
  }
  dispose(){const child=this.child;this.child=undefined;this.ready=undefined;for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(Error('Native CAD canceled'));}this.pending.clear();child?.kill();}
}
