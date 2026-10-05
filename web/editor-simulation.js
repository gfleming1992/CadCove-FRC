import {AssemblyViewer} from '../vendor/cad-core/src/core/assembly-viewer.js';
import {loadAssembly,bindSimulationScene,poseTransforms} from './simulation-scene.js';
import {LiveMotion,interpolatePose} from './live-motion.js';
const host=acquireVsCodeApi(),pending=new Map();let sequence=0,handleView;
function rpc(method,args={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Simulation host timed out'));},10000);pending.set(id,{resolve,reject,timer});host.postMessage({id,method,args});});}
window.addEventListener('message',async({data})=>{
 if(data.request){try{if(!handleView)throw Error('Scene is not ready');host.postMessage({reply:data.request,result:await handleView(data.method,data.args)});}catch(error){host.postMessage({reply:data.request,error:error.message});}return;}
 const request=pending.get(data.id);if(request){clearTimeout(request.timer);pending.delete(data.id);data.error?request.reject(Error(data.error)):request.resolve(data.result);}
});
const status=document.querySelector('#status'),canvas=document.querySelector('canvas');
async function main(){
 const config=window.cadcoveSimulation,viewer=await new AssemblyViewer(canvas).init(),cache=new Map();
 const [robot,field,bindings]=await Promise.all([loadAssembly('robot',config.assets.robot,{cache}),loadAssembly('field',config.assets.field,{cache}),fetch(config.bindings).then(r=>{if(!r.ok)throw Error('Missing scene bindings');return r.json();})]);
 if(bindings.worldHash!==config.worldHash)throw Error('Scene bindings changed; reopen simulation');
 const scene=bindSimulationScene(robot,field,bindings);viewer.setAssembly(scene);viewer.camera.target=bindings.start.map((v,i)=>v+(i===2?.25:0));viewer.camera.distance=4;viewer.request();
 const motion=new LiveMotion();
 let latest,lastRun,error='',follow=true,displayKey,frame=0,closed=false,lastReport=0;
 // This view never owns robot inputs. WPILib Driver Station (or an explicit
 // agent simulation run) owns enable/disable, joysticks and disconnect handling.
 window.addEventListener('pagehide',()=>{closed=true;cancelAnimationFrame(frame);viewer.device.destroy();});
 canvas.addEventListener('pointerdown',()=>{follow=false;});canvas.addEventListener('wheel',()=>{follow=false;});
 function display(state){viewer.setTransforms(poseTransforms(scene.instances,state));if(follow&&state.bodies.chassis){viewer.camera.target=state.bodies.chassis.position.map((v,i)=>v+(i===2?.25:0));viewer.request();}}
 function animate(){
  if(closed)return;
  if(!document.hidden){const sample=motion.sample(performance.now());if(sample){const key=lastRun+':'+sample.a.tick+':'+sample.b.tick+':'+sample.alpha;if(key!==displayKey){const bodies={};for(const [id,b] of Object.entries(sample.b.bodies))bodies[id]=interpolatePose(sample.a.bodies[id],b,sample.alpha);display({bodies});displayKey=key;}}}
  frame=requestAnimationFrame(animate);
 }
 async function update(){
  if(closed)return;
  try{
   const result=await rpc('state');if(result.error)throw Error(result.error);if(result.worldHash!==config.worldHash)throw Error('Physics/CAD revision changed; reopen simulation');
   if(!Number.isSafeInteger(result.state?.tick))throw Error('Waiting for the first physics tick');
   if(lastRun&&lastRun!==result.runId){motion.clear();}
   latest=result;lastRun=result.runId;motion.push(lastRun,result.state,performance.now());error='';
   status.textContent=Number.isFinite(result.pace)?`${Math.round(result.pace*100)}% real time`:'';
   status.removeAttribute('title');
  }catch(e){error=e.message;motion.clear();status.textContent='Physics unavailable';status.title=error;}
  if(performance.now()-lastReport>500){lastReport=performance.now();void rpc('report',{phase:error?'error':'ready',error,runId:lastRun,worldHash:config.worldHash,tick:latest?.state.tick,instances:scene.instances.length,prototypes:scene.prototypes.length,gpuBytes:viewer.gpuBytes,frames:viewer.frames,inputOwner:latest?.controlSource??'agent',camera:viewer.camera}).catch(()=>{});}
  if(!closed)setTimeout(update,document.hidden?250:33);
 }
 handleView=async(method,args={})=>{
  if(method==='practice')throw Error('Use WPILib Driver Station to enable and drive. This canvas is view-only.');
  if(method==='view'){
   if(args.follow!==undefined){if(typeof args.follow!=='boolean')throw Error('follow must be boolean');follow=args.follow;}
   if(args.fit){viewer.fit();follow=false;}if(args.view){viewer.view(args.view);follow=false;}
   if(args.camera){const c=args.camera;if(!Array.isArray(c.target)||c.target.length!==3||![...c.target,c.distance,c.yaw,c.pitch].every(Number.isFinite)||c.distance<=0||c.pitch<=0||c.pitch>=Math.PI)throw Error('Invalid camera');viewer.camera=structuredClone(c);follow=false;viewer.request();}
   return {schema:1,ok:true,camera:viewer.camera,follow};
  }
  if(method!=='capture')throw Error('Unknown view command');if(!latest||error)throw Error('Simulation is not ready');
  const snapshot=latest,scope=args.scope??'robot';if(!['robot','field','scene'].includes(scope))throw Error('Capture scope must be robot, field or scene');
  const bodies=args.bodies;if(bodies!==undefined&&(!Array.isArray(bodies)||!bodies.length||bodies.some(id=>!Object.hasOwn(snapshot.state.bodies,id))))throw Error('Unknown capture body');
  const selected=scene.instances.filter(n=>bodies?bodies.includes(n.body):scope==='scene'||n.id.startsWith(scope+'/'));if(!selected.length)throw Error('Empty capture selection');
  const captured=await viewer.captureView({ids:selected.map(n=>n.id),transforms:poseTransforms(selected,snapshot.state),view:args.view??'iso',width:args.width??960,height:args.height??720,...(args.camera?{camera:args.camera}:{})});
  return {runId:snapshot.runId,worldHash:snapshot.worldHash,tick:snapshot.state.tick,time:snapshot.state.time,scope,bodies,...captured};
 };
 animate();await update();
}
main().catch(error=>{status.textContent='Scene unavailable';status.title=error.message;void rpc('report',{phase:'error',error:error.message}).catch(()=>{});});
