import {AssemblyViewer} from '../vendor/cad-core/src/core/assembly-viewer.js';
import {decodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {installSelection} from '../vendor/cad-core/src/core/selection.js';
import {MechanismMotion} from '../vendor/cad-core/src/core/mechanism-motion.js';
import {createCanvasCommands,CANVAS_COMMANDS} from '../vendor/cad-core/src/core/canvas-commands.js';
import {identityTransform} from '../vendor/cad-core/src/core/mechanism.js';
import {loadAssembly,digest,gpuMatrix} from './simulation-scene.js';
import {compose,translation,cadMetres,quaternionMatrix} from '../lib/transforms.js';
const host=acquireVsCodeApi(),config=window.cadcoveMechanism,status=document.querySelector('#status');
let viewer,motion,scene,selection,commands,ready=false,mode='cad',placement=translation([0,0,0]),physics=null;
const robotIds=()=>scene.parts.map(p=>p.id);
function applyCAD(changes){viewer.setTransforms(Object.fromEntries(Object.entries(changes).map(([id,m])=>[id,gpuMatrix(compose(placement,cadMetres(m)))])));}
function applyPhysics(state){
 const changes={};
 for(const b of config.definition.bodies){const pose=state.bodies[b.id];if(!pose)throw Error('Missing physics body '+b.id);const m=compose(placement,compose(quaternionMatrix(pose.quaternion,pose.position),translation(b.origin.map(x=>-x/1000))));for(const id of b.parts)changes[id]=gpuMatrix(m);}
 viewer.setTransforms(changes);motion.updateVisuals({angles:Object.fromEntries(Object.entries(state.joints).map(([id,j])=>[id,(typeof j==='number'?j:j.position)*180/Math.PI]))});physics={tick:state.tick,joints:state.joints};
}
window.addEventListener('message',async({data})=>{
 if(data.physics){try{if(ready&&mode==='physics')applyPhysics(data.physics.state??data.physics);}catch(e){status.textContent=e.message;host.postMessage({report:{phase:'error',error:e.message}});}return;}
 if(!data.request)return;
 try{
  if(!ready)throw Error('Mechanism preview is loading');
  const canonical=data.method==='command',method=canonical?data.args.method:data.method,a=canonical?(data.args.args??{}):(data.args??{});let result;
  if(method==='state')result={...commands('state',a,{nativeUnits:!canonical}),physics,parts:robotIds().length};
  else if(method==='capabilities')result={...commands('capabilities'),commands:[...CANVAS_COMMANDS,'capture','place','physics','motors','zero','cad'],field:!!config.field};
  else if(CANVAS_COMMANDS.includes(method))result=commands(method,a,{nativeUnits:!canonical});
  else if(method==='physics'){motion.stop();mode='physics';status.textContent='Physics · direct motors · field is visual context';result={ok:true};}
  else if(method==='cad'){mode='cad';physics=null;motion.reset();status.textContent='CAD motion · no contact physics';result={ok:true};}
  else if(method==='capture'){const camera=a.camera&&canonical?{...a.camera,target:a.camera.target.map(v=>v/1000),distance:a.camera.distance/1000}:a.camera;result=await viewer.captureView({...a,camera,ids:a.ids??(a.scope==='field'?undefined:robotIds())});if(canonical){result.camera={...result.camera,target:result.camera.target.map(v=>v*1000),distance:result.camera.distance*1000};result.bounds={low:result.bounds.low.map(v=>v*1000),high:result.bounds.high.map(v=>v*1000)};}}
  else if(method==='place'){
   if(mode!=='cad')throw Error('Return to CAD before changing field placement');
   if(!Array.isArray(a.position)||a.position.length!==3||!a.position.every(Number.isFinite))throw Error('Position must be three metres values');
   placement=translation(canonical?a.position.map(v=>v/1000):a.position);motion.reset();result={ok:true,position:a.position};
  }else throw Error('Unknown preview action');
  await viewer.device.queue.onSubmittedWorkDone();
  host.postMessage({reply:data.request,result});
 }catch(error){host.postMessage({reply:data.request,error:error.message});}
});
(async()=>{
 viewer=await new AssemblyViewer(document.querySelector('canvas')).init();
 const badge=document.querySelector('#selection');
 selection=installSelection(viewer,state=>{badge.hidden=!state.parts.length;badge.textContent=state.parts.map(p=>p.name).join(' | ');});
 const response=await fetch(config.mesh);if(!response.ok)throw Error('Missing native CAD mesh');const bytes=await response.arrayBuffer();if(await digest(bytes)!==config.meshHash)throw Error('Native CAD mesh changed');scene=decodeScene(bytes);
 const field=config.field?await loadAssembly('field',config.field):{prototypes:[],instances:[]};
 viewer.setAssembly({prototypes:[...scene.parts,...field.prototypes],instances:[...scene.parts.map(p=>({id:p.id,name:p.name,asset:p.id,color:p.color,transform:gpuMatrix(identityTransform())})),...field.instances.map(n=>({...n,transform:gpuMatrix(n.matrix)}))]});
 // Adapter keeps shared CAD motion in mm; this combined scene renders in metres.
 const adapter={scene,draws:true,clearMarkers:()=>viewer.clearMarkers(),setTransforms:applyCAD,setDeformedParts:changes=>viewer.setDeformedParts(changes),setDeformedTopology:changes=>viewer.setDeformedTopology(changes)};
 motion=new MechanismMotion(adapter).load(config.definition);motion.reset();
 commands=createCanvasCommands({viewer,motion,selection,unitsPerMm:.001,mode:()=>mode,revision:()=>config.sourceRevision});
 ready=true;status.textContent='CAD motion · no contact physics';
 await new Promise(requestAnimationFrame);await viewer.device.queue.onSubmittedWorkDone();
 host.postMessage({report:{phase:'ready',parts:scene.parts.length,fieldParts:field.instances.length,gpuBytes:viewer.gpuBytes}});
})().catch(error=>{status.textContent=error.message;host.postMessage({report:{phase:'error',error:error.message}});});
window.addEventListener('pagehide',()=>{motion?.stop();viewer?.device.destroy();});
