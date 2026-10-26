import {installLiveParticles} from './live-particles.js';
import {installPhysicsReplay} from './scene-replay.js';
import {physicalVisuals} from './physical-shapes.js';
import {LiveMotion,interpolatePose} from './live-motion.js';
import {loadAssembly,bindPersistentScene,poseTransforms,selectSimulationBodies} from './simulation-scene.js';
import {compose,quaternionMatrix,inverse,translation} from '../lib/transforms.js';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0];
// CAD and field stay in one mm viewport; physics messages cross the SI boundary.
const millimetres=m=>m.map((v,i)=>i%4===3?v*1000:v);
export const installSceneExtension=({viewer,motion,selection,host,revision})=>{
 let particleSetupGeneration=0;
 let cadPose,loadGeneration=0,fieldAsset,fieldRevision,simulationRestore,physical={prototypes:[],instances:[],bindings:[]},simulationScene,simulationConfig,simulationFrame,visibleInstances,visibleBodies=null,follow=false,animation,disposed=false,native,imported,field={prototypes:[],instances:[]},mode='cad',definition,model,readiness,error,placement=identity,placedExplicitly=false;
 const particles=installLiveParticles({viewer,revision,placement:()=>placement});
 const replay=installPhysicsReplay({viewer,motion,revision,placement:()=>placement,onStop:()=>{if(mode==='replay')mode='cad';}});
 const live=new LiveMotion(),physicsFrames=new Map(),componentReadiness=new Map();
 const physicsState=()=>{const frames=[...physicsFrames.values()];return frames.length?{tick:Math.max(...frames.map(s=>s.tick??0)),bodies:Object.assign({},...frames.map(s=>s.bodies)),joints:Object.assign({},...frames.map(s=>s.joints))}:null;};
 function display(state){if(!simulationScene)return;viewer.setTransforms(Object.fromEntries(Object.entries(poseTransforms(simulationScene.instances,state)).map(([id,m])=>[id,m.map(v=>v*1000)])));if(follow&&state.bodies.chassis){viewer.camera.target=state.bodies.chassis.position.map((v,i)=>(v+(i===2?.25:0))*1000);viewer.request();}}
 function animate(){if(disposed)return;replay.tick(performance.now());if(mode==='replay')status();if(mode==='simulation'&&!document.hidden){const sample=live.sample(performance.now());if(sample){const bodies={};for(const [id,b]of Object.entries(sample.b.bodies))bodies[id]=interpolatePose(sample.a.bodies[id],b,sample.alpha);display({bodies});}}animation=requestAnimationFrame(animate);}
 animation=requestAnimationFrame(animate);
 const stopFollow=()=>{follow=false;};viewer.canvas.addEventListener('pointerdown',stopFollow);viewer.canvas.addEventListener('wheel',stopFollow);
 const setScene=viewer.setScene.bind(viewer),applyMotion=motion.apply.bind(motion);
 const placedPose=pose=>({...pose,transforms:Object.fromEntries(Object.entries(pose.transforms).map(([id,m])=>[id,compose(placement,m)]))});
 motion.apply=pose=>{cadPose=pose;return applyMotion(placedPose(pose));};
 const robotAssembly=()=>imported??{prototypes:native.parts,instances:native.parts.map(p=>({id:p.id,name:p.name,asset:p.id,color:p.color,transform:placement}))};
 function restoreSimulation(){
  live.clear();simulationScene=null;simulationFrame=null;
  if(simulationRestore){viewer.setTransforms(simulationRestore.transforms);viewer.setOpacity(simulationRestore.opacity);simulationRestore=null;}
 }
 function render(fit=false){
  particles.reset();
  if(!native&&!imported)return;
  if(native)viewer.scene=native;
  const opacity=Object.fromEntries([...(viewer.instanceLookup??[])].map(([id,i])=>[id,viewer.placements[i*20+19]]));
  const base=robotAssembly();
  // Scene placement and field/model attachment rebuild the assembly. Keep the
  // animator's refined topology, not the original coarse belt/cut/fold meshes.
  const topology=motion.scene===native?{...motion.belts?.renderParts(),...motion.surfaces?.renderParts()}:{};
  viewer.setAssembly({prototypes:[...base.prototypes.map(p=>topology[p.id]??p),...field.prototypes,...physical.prototypes],instances:[...base.instances,...field.instances,...physical.instances]},fit);
  if(mode==='cad'&&cadPose&&motion.scene===native)applyMotion(placedPose(cadPose));
  viewer.setOpacity(Object.fromEntries(Object.entries(opacity).filter(([id])=>viewer.instanceLookup.has(id))));
 }
 viewer.setScene=(scene,fit=false)=>{replay.unload();const opacity=Object.fromEntries([...(viewer.instanceLookup??[])].map(([id,i])=>[id,viewer.placements[i*20+19]]));loadGeneration++;restoreSimulation();motion.stop();cadPose=null;native=scene;imported=null;if(mode==='simulation')mode='cad';setScene(scene,false);render(fit);viewer.setOpacity(Object.fromEntries(Object.entries(opacity).filter(([id])=>viewer.instanceLookup.has(id))));};
 const badge=document.createElement('div');badge.style.cssText='position:absolute;right:12px;bottom:12px;padding:5px 8px;background:#17202bcc;color:#dce6ef;font:12px system-ui;pointer-events:none';document.body.append(badge);
 function status(){const counts={};for(const r of componentReadiness.values())counts[r.phase]=(counts[r.phase]??0)+1;const record=replay.state();const text=record.loaded?(record.error??('Recorded physics · '+(record.running?record.speed+'× playback':'paused')+' · '+(record.acceptance?.presentationDemoPassed===true&&record.acceptance?.physicalPredictionQualified!==true?'illustrative feed; prediction unqualified':record.acceptance?.passed===true?'recorded test passed':record.acceptance?.exitCriterionQualified===false?'unqualified recording':record.acceptance?.passed===false?'test failed':'unqualified recording'))):error??(Object.keys(counts).length?'Physics · '+Object.entries(counts).map(([phase,count])=>count+' '+phase).join(' · '):readiness?'Physics '+readiness.phase:'CAD · physics not configured');if(badge.textContent!==text)badge.textContent=text;}
 async function receive({data}){
  try{
  const e=data?.sceneEvent;if(!e)return;
  if(e.simulation){
   replay.unload();
   const config=e.simulation;error=null;
   if(!native&&!imported)throw Error('Open CAD before attaching simulation');
   if(config.bindings.worldHash!==config.worldHash)throw Error('Simulation bindings changed');
   if(config.revision!==revision())throw Error('CAD revision changed before simulation attachment');
   const bound=bindPersistentScene({robot:robotAssembly(),field,physical,nativeFrames:native?config.nativeFrames:null},config.bindings,config.bodyIds);
   if(native&&!config.nativeFrames)throw Error('Missing native CAD occurrence frames');
   restoreSimulation();motion.stop();simulationConfig=config;
   const transforms={},opacity={};
   for(const [id,i]of viewer.instanceLookup){transforms[id]=[0,1,2].flatMap(r=>[viewer.placements[i*20+r],viewer.placements[i*20+4+r],viewer.placements[i*20+8+r],viewer.placements[i*20+12+r]]);opacity[id]=viewer.placements[i*20+19];}
   simulationRestore={transforms,opacity};simulationScene=bound;
   viewer.setTransforms(Object.fromEntries(bound.instances.filter(n=>n.scope==='field').map(n=>[n.id,n.transform.map(v=>v*1000)])));
   visibleInstances=bound.instances;visibleBodies=null;mode='simulation';
  }
  if(e.simulationState&&mode==='simulation'&&simulationScene){
   if(e.simulationState.worldHash!==simulationConfig.worldHash)throw Error('Physics revision changed; rebuild bindings');
   simulationFrame=e.simulationState;live.push(simulationFrame.runId,simulationFrame.state,performance.now());
  }
  if(e.definition)definition=e.definition;
  if(e.particlesDisabled)particles.reset();
  if(e.model){particleSetupGeneration++;particles.reset();replay.unload();componentReadiness.clear();physicsFrames.clear();model=e.model;physical=physicalVisuals(model);error=null;if(mode!=='simulation')render();}
  if(e.error)error=e.error;
  if(e.readiness){e.readiness={...e.readiness,phase:e.readiness.phase??e.readiness.type?.replace(/^physics-/,'')??'unknown'};readiness=e.readiness;componentReadiness.set(e.readiness.component,e.readiness);if(e.readiness.phase!=='ready')particles.reset();if(e.readiness.phase!=='ready')physicsFrames.delete(e.readiness.component);}
  if(e.outdated){particleSetupGeneration++;particles.reset();replay.unload();error=null;loadGeneration++;readiness={phase:'outdated'};if(mode==='simulation'){restoreSimulation();mode='cad';}}
  if(e.mode){replay.unload();const wasSimulation=mode==='simulation';if(wasSimulation)restoreSimulation();mode=e.mode;motion.stop();if(mode==='cad'&&!wasSimulation)render();}
  if(e.physics&&mode==='physics'&&native){
   if(e.physics.reset)particles.reset();
   const state=e.physics.state.state??e.physics.state,changes={};physicsFrames.set(e.physics.component,state);
   for(const b of model.bodies){const pose=state.bodies[b.id];if(!pose)continue;
    // Meshes are authored in the assembly frame; remove the body's bind pose.
    const bind=b.cadFrame??b,angle=Math.hypot(...bind.rotation),axis=angle?bind.rotation.map(x=>x/angle):[0,0,1],q=[...axis.map(x=>x*Math.sin(angle/2)),Math.cos(angle/2)];
    const matrix=millimetres(compose(quaternionMatrix(pose.quaternion,pose.position),inverse(quaternionMatrix(q,bind.position))));
    for(const id of b.parts)if(viewer.instanceLookup?.has(id))changes[id]=compose(placement,matrix);
   }
   for(const binding of physical.bindings){const pose=state.bodies[binding.body];if(pose&&viewer.instanceLookup?.has(binding.id))changes[binding.id]=millimetres(compose(quaternionMatrix(pose.quaternion,pose.position),binding.local));}
   viewer.setTransforms(changes);
   if(e.physics.state.deformation)particles.apply(e.physics.state.deformation);
  }
  status();
  }catch(e){error=e.message;status();}
 }
 window.addEventListener('message',receive);
 return {setImported(assembly){replay.unload();loadGeneration++;restoreSimulation();mode='cad';imported=assembly;native=null;fieldAsset=undefined;fieldRevision=undefined;field={prototypes:[],instances:[]};render();},mode:()=>mode,describe:()=>({physics:physicsState(),physicsReadiness:readiness,physicsComponents:[...componentReadiness.values()],physicalModel:!!model,replay:replay.state(),particles:particles.state(),commands:['state','view','selection','visibility','opacity','highlight','reveal','motion','capture','physics','motors','zero','cad','field','physics-status','physics-wait','physics-particles','replay']}),
  async command(method,args={}){
   if(method==='physics-particles'){
    if(args.action==='state')return {ok:true,...particles.state()};
    if(mode!=='cad')throw Error('Return to stopped CAD mode before configuring particle presentation');
    const setupGeneration=++particleSetupGeneration;
    const result=await host.request('scene:physics-particles',args);if(setupGeneration!==particleSetupGeneration)throw Error('Particle stream request superseded');if(!result.ok)return result;
    if(args.action==='disable'){particles.reset();return result;}
    const visualIds=Object.fromEntries(result.bodyIds.map(id=>[id,[...(model?.bodies.find(b=>b.id===id)?.parts??[]),...physical.bindings.filter(b=>b.body===id).map(b=>b.id)]]));
    try{await particles.configure({...result,visualIds});}catch(e){if(setupGeneration===particleSetupGeneration)await host.request('scene:physics-particles',{action:'disable'});throw e;}
    return {...result,presentation:particles.state()};
   }
   if(method==='replay'){if(args.action==='load'){particles.reset();if(mode!=='cad'&&mode!=='replay')throw Error('Pause physics and return to CAD before loading replay');await replay.load(args.replay);mode='replay';}else if(args.action==='unload'){replay.unload();mode='cad';}else replay.command(args);status();return {ok:true,...replay.state()};}
   if(mode==='replay'&&['physics','motors','zero','motion','place','field','attach-simulation'].includes(method))throw Error('Unload recorded replay before changing scene dynamics');
   if(method==='cad'&&mode==='replay'){replay.unload();mode='cad';status();return {ok:true};}
   if(method==='motion'&&mode!=='cad'&&!['state','list'].includes(args.action))throw Error('Return to CAD before changing the authored pose');
   if(method==='attach-simulation'){await receive({data:{sceneEvent:{simulation:args}}});if(error)throw Error(error);return {ok:true};}
   if(method==='simulation-state')return {ok:true,mode,camera:{...viewer.camera,target:viewer.camera.target.map(v=>v/1000),distance:viewer.camera.distance/1000},follow,bodies:visibleBodies,tick:simulationFrame?.state.tick,runId:simulationFrame?.runId,worldHash:simulationConfig?.worldHash,instances:simulationScene?.instances.length??0,error};
   if(method==='simulation-view'){
    if(!simulationScene||mode!=='simulation')throw Error('Simulation is not active');
    if(args.bodies!==undefined){visibleInstances=selectSimulationBodies(simulationScene.instances,args.bodies);visibleBodies=args.bodies;const ids=new Set(visibleInstances.map(n=>n.id));viewer.setOpacity(Object.fromEntries(simulationScene.instances.map(n=>[n.id,ids.has(n.id)?simulationRestore.opacity[n.id]??1:0])));}
    if(args.follow!==undefined){if(typeof args.follow!=='boolean')throw Error('follow must be boolean');follow=args.follow;}
    if(args.fit||args.view||args.camera){selection.view({...(args.fit?{ids:visibleInstances.map(n=>n.id),fit:true}:{}),...(args.view?{view:args.view}:{}),...(args.camera?{camera:{...args.camera,target:args.camera.target.map(v=>v*1000),distance:args.camera.distance*1000}}:{})});follow=false;}
    return {ok:true,camera:{...viewer.camera,target:viewer.camera.target.map(v=>v/1000),distance:viewer.camera.distance/1000},follow,bodies:visibleBodies,visibleInstances:visibleInstances.length,physicsScope:'unchanged'};
   }
   if(method==='simulation-capture'){
    if(!simulationFrame||mode!=='simulation'||error)throw Error(error??'Simulation is not ready');
    const snapshot=simulationFrame,scope=args.scope??'robot';if(!['robot','field','scene'].includes(scope))throw Error('Invalid capture scope');
    if(args.bodies!==undefined&&(!Array.isArray(args.bodies)||!args.bodies.length||args.bodies.some(id=>!snapshot.state.bodies[id])))throw Error('Unknown capture body');
    const selected=(args.bodies?simulationScene.instances:visibleInstances).filter(n=>args.bodies?args.bodies.includes(n.body):scope==='scene'||n.scope===scope);if(!selected.length)throw Error('Empty capture selection');
    const transforms=Object.fromEntries(Object.entries(poseTransforms(selected,snapshot.state)).map(([id,m])=>[id,m.map(v=>v*1000)]));
    const result=await viewer.captureView({ids:selected.map(n=>n.id),transforms,view:args.view??'iso',width:args.width??960,height:args.height??720,...(args.camera?{camera:{...args.camera,target:args.camera.target.map(v=>v*1000),distance:args.camera.distance*1000}}:{})});
    return {...result,camera:{...result.camera,target:result.camera.target.map(v=>v/1000),distance:result.camera.distance/1000},runId:snapshot.runId,worldHash:snapshot.worldHash,tick:snapshot.state.tick,time:snapshot.state.time,scope,bodies:args.bodies};
   }
   if(method==='capture'&&mode==='simulation')return viewer.captureView(args);
   if(['physics','motors','zero','cad','physics-status','physics-wait'].includes(method)){
    if(method==='physics'){motion.stop();if(motion.model&&!definition?.physical)args={...args,initialAngles:motion.state().angles};}return host.request('scene:'+method,args);
   }
   if(method==='field'){
    const info=await host.request('scene:field');
    if(args.revision!==undefined&&args.revision!==info.revision)throw Error('Field CAD revision changed; rebuild simulation bindings');
    if(fieldAsset===info.field&&fieldRevision===info.revision)return {ok:true,fieldParts:field.instances.length,reused:true};
    if(mode==='simulation')throw Error('Return to CAD before replacing field geometry');
    const generation=loadGeneration,assembly=await loadAssembly('field',info.field);
    if(generation!==loadGeneration||disposed)throw Error('Scene changed during field load');
    field={prototypes:assembly.prototypes,instances:assembly.instances.map(n=>({...n,transform:millimetres(n.matrix)}))};fieldAsset=info.field;fieldRevision=info.revision;
    if(!placedExplicitly&&info.defaultPositionMm){placement=translation(info.defaultPositionMm);placedExplicitly=true;}
    render();return {ok:true,fieldParts:field.instances.length,contactPhysics:'Only physical bodies explicitly defined in mechanism.json participate'};
   }
   if(method==='place'){
    if(mode!=='cad')throw Error('Return to CAD before changing presentation placement');
    if(!Array.isArray(args.position)||args.position.length!==3||!args.position.every(Number.isFinite))throw Error('Position must be three millimetre values');
    placement=translation(args.position);placedExplicitly=true;render();return {ok:true,position:args.position,presentationOnly:true};
   }
  },dispose(){particleSetupGeneration++;particles.dispose();replay.unload();motion.apply=applyMotion;disposed=true;cancelAnimationFrame(animation);viewer.canvas.removeEventListener('pointerdown',stopFollow);viewer.canvas.removeEventListener('wheel',stopFollow);window.removeEventListener('message',receive);badge.remove();}};
};
