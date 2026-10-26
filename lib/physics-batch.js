// Isolated, unpaced native trials. No Java, viewer, live-state mutation or
// automatic hardware sign-off. Each numerical profile starts from source state.
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MechanismSession} from './mechanism-session.js';
import {requireMechanismCapabilities} from './physics-capabilities.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,allowed,label)=>{if(!object(x)||Object.keys(x).some(k=>!allowed.includes(k)))throw Error('Invalid '+label);};
export function numericalWorld(source,settings){
 keys(settings,['dt','solver_iterations','solver_schedule','max_contact_substeps','soft_contact_max_angle_rad','local_cylinder_contacts'],'numerical settings');
 const w=structuredClone(source);
 for(const [k,v] of Object.entries(settings)){
  if(k==='max_contact_substeps'&&v===null){delete w[k];continue;}
  const valid=k==='local_cylinder_contacts'?typeof v==='boolean':k==='dt'?Number.isFinite(v)&&v>0&&v<=.02:k==='solver_iterations'?Number.isInteger(v)&&v>=1&&v<=32:k==='max_contact_substeps'?Number.isInteger(v)&&v>=1&&v<=64:k==='soft_contact_max_angle_rad'?Number.isFinite(v)&&v>=.05&&v<=.6:['per_refresh','per_tick'].includes(v);
  if(!valid)throw Error('Invalid numerical setting: '+k);
  w[k]=v;
 }
 return w;
}
export function validatePhysicsBatch(world,plan){
 keys(plan,['profiles','segments','checks'],'physics batch plan');
 if(!Array.isArray(plan.profiles)||!plan.profiles.length||plan.profiles.length>8)throw Error('Supply 1–8 numerical profiles');
 const ids=new Set();
 for(const p of plan.profiles){keys(p,['id','settings'],'profile');if(typeof p.id!=='string'||!p.id||ids.has(p.id))throw Error('Profiles need unique IDs');ids.add(p.id);numericalWorld(world,p.settings);}
 if(!Array.isArray(plan.segments)||!plan.segments.length||plan.segments.length>256)throw Error('Supply 1–256 motor segments');
 const motors=new Set((world.motors??[]).map(m=>m.id));let seconds=0;
 for(const s of plan.segments){
  keys(s,['seconds','volts'],'segment');
  if(!Number.isFinite(s.seconds)||s.seconds<=0||!object(s.volts))throw Error('Segments require positive seconds and motor voltages');
  for(const [id,v] of Object.entries(s.volts))if(!motors.has(id)||!Number.isFinite(v)||Math.abs(v)>12)throw Error('Unknown motor or voltage outside ±12 V: '+id);
  seconds+=s.seconds;
 }
 if(seconds>600)throw Error('Batch duration exceeds 600 simulated seconds per profile');
 for(const p of plan.profiles){const dt=p.settings.dt??world.dt??.005;if(!Number.isFinite(dt)||dt<=0||dt>.02||Math.ceil(seconds/dt)>500000)throw Error('Invalid timestep or more than 500000 ticks per profile');}
 const c=plan.checks??{};keys(c,['maxLinearSpeed','positions','joints'],'acceptance checks');
 if(c.maxLinearSpeed!==undefined&&(!Number.isFinite(c.maxLinearSpeed)||c.maxLinearSpeed<=0))throw Error('Invalid speed limit');
 for(const [kind,names] of [['positions',new Set(world.bodies.map(b=>b.id))],['joints',new Set((world.joints??[]).map(j=>j.id))]]){
  if(c[kind]!==undefined&&!Array.isArray(c[kind]))throw Error('Invalid '+kind+' checks');
  for(const r of c[kind]??[]){keys(r,kind==='positions'?['id','axis','min','max']:['id','min','max'],'range check');if(!names.has(r.id)||!Number.isFinite(r.min)||!Number.isFinite(r.max)||r.min>r.max||kind==='positions'&&![0,1,2].includes(r.axis))throw Error('Invalid '+kind+' range');}
 }
 return plan;
}
function inspect(state,world){
 if(!state||!Number.isFinite(state.time)||!Number.isInteger(state.tick))throw Error('Invalid native clock');
 let speed=0;
 for(const body of world.bodies){
  const b=state.bodies?.[body.id];
  for(const [key,size] of [['position',3],['quaternion',4],['velocity',3],['angular_velocity',3]])if(!Array.isArray(b?.[key])||b[key].length!==size||!b[key].every(Number.isFinite))throw Error('Invalid body state: '+body.id);
  speed=Math.max(speed,Math.hypot(...b.velocity));
 }
 for(const joint of world.joints??[]){const j=state.joints?.[joint.id];if(!Number.isFinite(j?.position)||!Number.isFinite(j?.velocity))throw Error('Invalid joint state: '+joint.id);}
 const owners=[state.gameplay,...Object.values(state.robot_gameplay??{})].filter(Boolean).flatMap(g=>g.carried??[]);
 if(new Set(owners).size!==owners.length||owners.some(id=>!state.bodies[id]))throw Error('Invalid game-piece ownership');
 return speed;
}
export async function runPhysicsBatch({binary,world,plan,assetRoot,signal,onProgress=()=>{}}){
 world=structuredClone(world);plan=structuredClone(validatePhysicsBatch(world,plan));
 const provenance={sourceWorldHash:hash(JSON.stringify(world)),planHash:hash(JSON.stringify(plan)),nativeHash:hash(await readFile(binary))};
 const trials=[];
 for(const p of plan.profiles){
  if(signal?.aborted)throw Error('Physics batch cancelled');
  const selected=numericalWorld(world,p.settings),dt=selected.dt??.005;
  const session=new MechanismSession(binary,{assetRoot,requestTimeoutMs:30000});
  const abort=()=>session.close(Error('Physics batch cancelled'));signal?.addEventListener('abort',abort,{once:true});
  const trial={id:p.id,settings:p.settings,worldHash:hash(JSON.stringify(selected)),dt,ok:false};
  try{
   if(signal?.aborted)throw Error('Physics batch cancelled');
   let state=(await session.startWorld(selected)).state;
   requireMechanismCapabilities(await session.request({op:'capabilities'}),selected.mechanisms);
   let maxLinearSpeed=inspect(state,selected),end=0,ticks=0,physicsMs=0;const appliedSegments=[];
   const started=performance.now();
   for(let i=0;i<plan.segments.length;i++){
    const segment=plan.segments[i];end+=segment.seconds;
    // Integer target ticks avoid floating-point drift and extra ticks at exact boundaries.
    const target=Math.ceil(end/dt-1e-9);
    appliedSegments.push({index:i,firstTick:ticks+1,lastTick:target,volts:segment.volts});
    while(ticks<target){
     if(signal?.aborted)throw Error('Physics batch cancelled');
     const reply=await session.request({op:'step',steps:1,volts:segment.volts});state=reply.state;ticks++;
     if(state?.tick!==ticks||Math.abs(state.time-ticks*dt)>Math.max(1e-5,ticks*dt*1e-6))throw Error('Native timestep does not match selected profile');
     maxLinearSpeed=Math.max(maxLinearSpeed,inspect(state,selected));physicsMs+=reply.physicsMs??0;
     if(ticks%20===0)onProgress({profile:p.id,tick:ticks,time:state.time,segment:i});
    }
   }
   const checks=plan.checks??{},failures=[];
   if(checks.maxLinearSpeed!==undefined&&maxLinearSpeed>checks.maxLinearSpeed)failures.push('maxLinearSpeed');
   for(const r of checks.positions??[]){const v=state.bodies[r.id].position[r.axis];if(v<r.min||v>r.max)failures.push('position:'+r.id+':'+r.axis);}
   for(const r of checks.joints??[]){const v=state.joints[r.id].position;if(v<r.min||v>r.max)failures.push('joint:'+r.id);}
   const acceptanceSpecified=checks.maxLinearSpeed!==undefined||!!checks.positions?.length||!!checks.joints?.length;
   Object.assign(trial,{ok:!failures.length,structuralChecksPassed:true,acceptanceSpecified,accepted:acceptanceSpecified?!failures.length:null,failures,ticks,appliedSegments,simSeconds:state.time,wallSeconds:(performance.now()-started)/1000,physicsMs,maxLinearSpeed,final:state});
  }catch(error){if(signal?.aborted)throw Error('Physics batch cancelled');trial.error=error.message;}
  finally{signal?.removeEventListener('abort',abort);session.close();}
  trials.push(trial);onProgress({profile:p.id,finished:true,ok:trial.ok});
 }
 return {schema:1,ok:trials.every(t=>t.ok),headless:true,rendering:false,robotCode:false,qualification:'isolated-native-trials; caller-defined acceptance only; not hardware sign-off',provenance,plan,trials};
}
export const batchSummary=r=>({...r,trials:r.trials.map(({final,...trial})=>trial)});
// One job at a time protects the interactive simulator from unbounded batch
// workers. Native processes do the heavy work; the editor event loop stays free.
export class PhysicsBatchJobs{
 constructor(){this.jobs=new Map();this.closed=false;}
 start(options,{save=async()=>undefined}={}){
  if(this.closed)throw Error('Physics batch service closed');
  if([...this.jobs.values()].some(j=>j.phase==='running'))throw Error('A physics batch is already running');
  if(this.jobs.size>=16)this.jobs.delete(this.jobs.keys().next().value);
  const id=randomUUID(),controller=new AbortController(),job={id,phase:'running',controller};this.jobs.set(id,job);
  job.done=runPhysicsBatch({...options,signal:controller.signal,onProgress:p=>{job.progress=p;}}).then(async r=>{
   if(controller.signal.aborted)throw Error('Physics batch cancelled');
   job.reportFile=await save(r);job.result=batchSummary(r);job.phase=controller.signal.aborted?'cancelled':'complete';
  }).catch(e=>{job.phase=controller.signal.aborted?'cancelled':'failed';job.error=e.message;});
  return this.status(id);
 }
 status(id){const j=this.jobs.get(id);if(!j)throw Error('Unknown physics batch');return {id,phase:j.phase,pending:j.phase==='running',progress:j.progress,reportFile:j.reportFile,result:j.result,error:j.error};}
 cancel(id){const j=this.jobs.get(id);if(!j)throw Error('Unknown physics batch');if(j.phase==='running')j.controller.abort();return this.status(id);}
 close(){this.closed=true;for(const j of this.jobs.values())if(j.phase==='running')j.controller.abort();}
}
