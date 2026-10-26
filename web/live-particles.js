import {GpuDeformation,createDeformationPrototype} from './deformation-gpu.js';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0],prefix='live-particles/';
// Optional authoritative stream presentation. Initial opt-in allocates surface
// topology once. Subsequent samples, representation switches and reset reuse CAD
// buffers. No prediction, physics stepping or CPU deformation takes place here.
export function installLiveParticles({viewer,revision,placement=()=>identity}){
 let config=null,entries=new Map(),generation=0,lastTick=-1,updates=0,error=null;
 const restore=()=>{const changes={};for(const entry of entries.values()){entry.gpu.dispose();for(const [id,alpha]of Object.entries(entry.original))if(viewer.instanceLookup?.has(id))changes[id]=entry.mode==='soft'&&viewer.instanceLookup?.has(entry.id)&&viewer.placements[viewer.instanceLookup.get(entry.id)*20+19]===0?0:alpha;if(viewer.instanceLookup?.has(entry.id))changes[entry.id]=0;}entries.clear();if(Object.keys(changes).length)viewer.setOpacity(changes);};
 function reset(){generation++;restore();config=null;lastTick=-1;updates=0;error=null;}
 function state(){return {enabled:!!config,streamId:config?.streamId,physicsRevision:config?.revision,sourceRevision:config?.sourceRevision,lastTick,updates,error,bodies:[...entries.keys()],gpu:[...entries.values()].map(e=>e.gpu.stats)};}
 return {state,reset,dispose:reset,
 async configure(value){
  if(value.sourceRevision!==revision())throw Error('Particle stream CAD revision is stale');
  if(value.schema!==1||typeof value.streamId!=='string'||typeof value.revision!=='string'||!Array.isArray(value.bodyIds)||!value.bodyIds.length||value.bodyIds.length>4||new Set(value.bodyIds).size!==value.bodyIds.length)throw Error('Invalid live particle configuration');
  const m=placement();if(m.length!==12||m.some((n,i)=>!Number.isFinite(n)||(i%4!==3&&Math.abs(n-identity[i])>1e-9)))throw Error('Live particles currently require translation-only scene placement');
  const definitions=value.bodyIds.map(body=>{const topology=value.topologies?.[body],visualIds=value.visualIds?.[body];if(!Array.isArray(visualIds)||!visualIds.length||visualIds.some(id=>!viewer.instanceLookup?.has(id)))throw Error('Missing rigid visual fallback for '+body);const count=topology?.particleCount??(topology?.centerParticleIndex+1);if(!Number.isInteger(count)||count>163)throw Error('Live particle count exceeds bounded sphere presentation');const id=prefix+encodeURIComponent(body),prototype=createDeformationPrototype(id,topology,new Float32Array(count*3));return {body,id,topology,visualIds,prototype};});
  reset();const gen=generation,base=viewer.assemblyDefinition,oldOpacity=Object.fromEntries([...viewer.instanceLookup].map(([id,i])=>[id,viewer.placements[i*20+19]]));
  // Preserve live placements and current refined belt meshes during one-time setup.
  const instances=base.instances.filter(n=>!n.id.startsWith(prefix)).map(n=>{const i=viewer.instanceLookup.get(n.id);return {...n,opacity:oldOpacity[n.id]??n.opacity??1,transform:[0,1,2].flatMap(r=>[viewer.placements[i*20+r],viewer.placements[i*20+4+r],viewer.placements[i*20+8+r],viewer.placements[i*20+12+r]])};});
  viewer.setAssembly({prototypes:[...base.prototypes.filter(p=>!p.id.startsWith(prefix)).map(p=>viewer.deformedParts?.get(p.id)??p),...definitions.map(d=>d.prototype)],instances:[...instances,...definitions.map(d=>({id:d.id,asset:d.id,color:d.prototype.color,transform:identity,opacity:0}))]},false);
  try{
   for(const d of definitions){const gpu=await GpuDeformation.create(viewer,d.id,d.topology,{offsetMm:[m[3],m[7],m[11]]});if(gen!==generation){gpu.dispose();throw Error('Particle stream setup superseded');}entries.set(d.body,{...d,gpu,mode:'rigid',original:Object.fromEntries(d.visualIds.map(id=>[id,oldOpacity[id]??1]))});}
   config=value;return state();
  }catch(e){if(gen===generation){error=e.message;reset();}throw e;}
 },
 apply(packet){
  if(!config)return false;
  if(config.sourceRevision!==revision()){reset();return false;}
  if(packet.streamId!==config.streamId||packet.revision!==config.revision)return false;
  if(!Number.isSafeInteger(packet.tick)||packet.tick<=lastTick)return false;
  if(!Number.isFinite(packet.time)||!packet.bodies||Object.keys(packet.bodies).some(id=>!entries.has(id)))throw Error('Invalid authoritative particle frame');
  try{
   for(const [body,value]of Object.entries(packet.bodies)){const entry=entries.get(body);if(value.representation==='soft'){entry.gpu.update({particlesA:value.particles});if(entry.mode!=='soft'){entry.original=Object.fromEntries(entry.visualIds.map(id=>[id,viewer.placements[viewer.instanceLookup.get(id)*20+19]]));const alpha=Math.max(...Object.values(entry.original));viewer.setOpacity({...Object.fromEntries(entry.visualIds.map(id=>[id,0])),[entry.id]:alpha});entry.mode='soft';}}else if(value.representation==='rigid'){if(entry.mode==='soft'){const alpha=viewer.placements[viewer.instanceLookup.get(entry.id)*20+19];viewer.setOpacity({...Object.fromEntries(Object.entries(entry.original).map(([id,original])=>[id,alpha===0?0:original])),[entry.id]:0});entry.mode='rigid';}}else throw Error('Unknown streamed particle representation');}
   lastTick=packet.tick;updates++;return true;
  }catch(e){error=e.message;restore();config=null;throw e;}
 }
 };
}
