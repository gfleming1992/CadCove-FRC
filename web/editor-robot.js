import {AssemblyViewer} from '../vendor/cad-core/src/core/assembly-viewer.js';
import {loadAssembly,gpuMatrix} from './simulation-scene.js';
const host=acquireVsCodeApi(),status=document.querySelector('#status');
let viewer,ready=false;
window.addEventListener('message',async({data})=>{
 if(!data.request)return;
 try{
  if(!ready)throw Error('Robot CAD is still loading');
  let result;
  if(data.method==='capture')result=await viewer.captureView(data.args);
  else if(data.method==='view'){if(data.args.fit)viewer.fit();if(data.args.view)viewer.view(data.args.view);viewer.request();result={camera:viewer.camera};}
  else throw Error('Unknown robot view action');
  host.postMessage({reply:data.request,result});
 }catch(error){host.postMessage({reply:data.request,error:error.message});}
});
(async()=>{
 viewer=await new AssemblyViewer(document.querySelector('canvas')).init();
 const scene=await loadAssembly('robot',window.cadcoveRobot.asset);
 viewer.setAssembly({...scene,instances:scene.instances.map(n=>({...n,transform:gpuMatrix(n.matrix)}))});
 await new Promise(requestAnimationFrame);
 await viewer.device.queue.onSubmittedWorkDone();
 ready=true;status.textContent='';
 host.postMessage({report:{phase:'ready',instances:scene.instances.length,prototypes:scene.prototypes.length,gpuBytes:viewer.gpuBytes}});
})().catch(error=>{status.textContent='Robot CAD unavailable';status.title=error.message;host.postMessage({report:{phase:'error',error:error.message}});});
window.addEventListener('pagehide',()=>viewer?.device.destroy());
