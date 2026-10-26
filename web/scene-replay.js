import {GpuDeformation} from './deformation-gpu.js';
import {validatePhysicsReplay,replaySample,replayTransforms,ReplayClock} from './physics-replay.js';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0],ballId='replay/deformable-ball';
const instanceMatrix=(v,i)=>[0,1,2].flatMap(r=>[v.placements[i*20+r],v.placements[i*20+4+r],v.placements[i*20+8+r],v.placements[i*20+12+r]]);
export function installPhysicsReplay({viewer,motion,revision,placement,onStop=()=>{}}){
 let record,clock,gpu,restore,lastTime,error,generation=0;
 function state(){return record?{...clock.state(),loaded:true,sourceRevision:record.sourceRevision,acceptance:record.acceptance??null,scope:record.scope??'Recorded physics',error,gpu:gpu?.stats}: {loaded:false};}
 function apply(){if(!record||!gpu)return;const sample=replaySample(record,clock.time);viewer.setTransforms(replayTransforms(record,sample,placement()));gpu.update({particlesA:sample.a.ball.particles,particlesB:sample.b.ball.particles,alpha:sample.alpha});lastTime=clock.time;}
 function unload(){generation++;gpu?.dispose();gpu=null;record=null;clock=null;lastTime=null;error=null;if(restore){const saved=restore;restore=null;viewer.setAssembly(saved,false);viewer.setOpacity(saved.opacity);}onStop();}
 return {state,unload,
 async load(value){
  value=validatePhysicsReplay(value,revision(),new Set(viewer.instanceLookup.keys()));
  unload();const gen=generation;motion.stop();
  const original=viewer.assemblyDefinition;
  restore={prototypes:original.prototypes.map(p=>viewer.deformedParts?.get(p.id)??p),instances:original.instances.map(n=>({...n,transform:instanceMatrix(viewer,viewer.instanceLookup.get(n.id))})),opacity:Object.fromEntries([...viewer.instanceLookup].map(([id,i])=>[id,viewer.placements[i*20+19]]))};
  const first=value.frames[0].ball.particles,positions=new Float32Array(first.slice(0,value.topology.surfaceVertexCount).flat().map(x=>x*1000));
  const prototype={id:ballId,name:'Recorded deformable ball',color:'#e9bd48',positions,normals:new Float32Array(positions.length),indices:new Uint32Array(value.topology.indices)};
  const offset=placement(),visible=new Set(Object.keys(value.bindings));
  try{
   viewer.setAssembly({prototypes:[...restore.prototypes,prototype],instances:[...restore.instances,{id:ballId,asset:ballId,color:'#e9bd48',transform:identity}]},false);
   viewer.setOpacity(Object.fromEntries([...viewer.instanceLookup].map(([id])=>[id,visible.has(id)||id===ballId?1:0])));
   const candidate=await GpuDeformation.create(viewer,ballId,value.topology,{scale:1000,offsetMm:[offset[3],offset[7],offset[11]]});
   if(gen!==generation){candidate.dispose();throw Error('Replay load superseded');}
   gpu=candidate;record=value;clock=new ReplayClock(value);apply();return state();
  }catch(e){if(gen===generation)unload();throw e;}
 },
 command(args){if(!record)throw Error('Load a physics replay first');clock.command(args,performance.now());apply();return state();},
 tick(now){if(!clock)return;clock.tick(now);if(clock.time===lastTime)return;try{apply();}catch(e){clock.running=false;error=e.message;}},
 };
}
