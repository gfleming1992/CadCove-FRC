import {installSceneExtension} from './scene-extension.js';
import {installSelection} from '../vendor/cad-core/src/core/selection.js';
import {MechanismMotion} from '../vendor/cad-core/src/core/mechanism-motion.js';
import {createCanvasCommands} from '../vendor/cad-core/src/core/canvas-commands.js';
import {AssemblyViewer} from '../vendor/cad-core/src/core/assembly-viewer.js';
import {loadAssembly,gpuMatrix} from './simulation-scene.js';
const host=acquireVsCodeApi(),status=document.querySelector('#status');
let viewer,extension,commands,ready=false,serial=0;const pending=new Map();
const request=(method,args={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Scene request timed out'));},60000);pending.set(id,{resolve,reject,timer});host.postMessage({id,method,args});});
window.addEventListener('message',async({data})=>{
 if(data.id&&pending.has(data.id)){const p=pending.get(data.id);pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(Error(data.error)):p.resolve(data.result);return;}
 if(!data.request)return;
 try{
  if(!ready)throw Error('Robot CAD is still loading');
  let result=await extension.command(data.method,data.args);
  if(result!==undefined){}
  else if(data.method==='capture')result=await viewer.captureView(data.args);
  else if(data.method==='view'){if(data.args.fit)viewer.fit();if(data.args.view)viewer.view(data.args.view);viewer.request();result={camera:viewer.camera};}
  else result=commands(data.method,data.args);
  host.postMessage({reply:data.request,result});
 }catch(error){host.postMessage({reply:data.request,error:error.message});}
});
(async()=>{
 viewer=await new AssemblyViewer(document.querySelector('canvas')).init();
 const selection=installSelection(viewer),motion=new MechanismMotion(viewer);extension=installSceneExtension({viewer,motion,selection,host:{request},revision:()=>null});commands=createCanvasCommands({viewer,motion,selection,mode:extension.mode});
 const scene=await loadAssembly('robot',window.cadcoveRobot.asset);
 extension.setImported({...scene,instances:scene.instances.map(n=>({...n,transform:gpuMatrix(n.matrix).map(x=>x*1000)}))});
 await new Promise(requestAnimationFrame);
 await viewer.device.queue.onSubmittedWorkDone();
 ready=true;status.textContent='';
 host.postMessage({report:{phase:'ready',instances:scene.instances.length,prototypes:scene.prototypes.length,gpuBytes:viewer.gpuBytes}});
})().catch(error=>{status.textContent='Robot CAD unavailable';status.title=error.message;host.postMessage({report:{phase:'error',error:error.message}});});
window.addEventListener('pagehide',()=>{extension?.dispose();viewer?.device.destroy();});
