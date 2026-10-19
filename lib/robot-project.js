import {validateCustomSimulator} from './runtime-location.js';
import {validatePracticeControls} from './practice-controls.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifySourceInputs} from './source-freshness.js';
import {validateSceneBindings,validateBindingAxes} from './scene-bindings.js';
export const companionRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// This boundary contains no team names, CAD occurrence IDs or mechanism names.
// A project supplies compiled artifacts; the runtime consumes the same contract
// whether those artifacts were authored, inferred with AI, or imported.
export async function readRobotProject(file=process.env.INSTANTCAD_PROJECT||path.join(companionRoot,'robot.sim.json')){
 const profilePath=path.resolve(file),root=path.dirname(profilePath),profile=await Bun.file(profilePath).json();
 if(profile.schema!==1||typeof profile.id!=='string'||!profile.id||typeof profile.name!=='string')throw Error('Invalid robot.sim.json identity/schema');
 const resolve=value=>{if(typeof value!=='string'||!value.trim())throw Error('Missing project path');return path.resolve(root,value);};
 if(profile.runtime?.adapter!=='wpilib-java-phoenix6')throw Error('Unsupported robot runtime adapter: '+profile.runtime?.adapter);
 if(profile.runtime.clock!==undefined&&!['physics','wall'].includes(profile.runtime.clock))throw Error('Unsupported robot clock: '+profile.runtime.clock);
 if(profile.runtime.controlSource!==undefined&&!['agent','driverstation'].includes(profile.runtime.controlSource))throw Error('Unsupported control source');
 if(profile.runtime.driverStation!==undefined&&(profile.runtime.controlSource!=='driverstation'||!['gui','socket'].includes(profile.runtime.driverStation)))throw Error('driverStation must be gui or socket with controlSource driverstation');
 for(const key of ['jdk','assetRoot'])if(profile.runtime[key]!==undefined)resolve(profile.runtime[key]);
 if(profile.physicsMode&&!['accurate','gameplay'].includes(profile.physicsMode.name))throw Error('Unsupported physics mode');
 if(profile.runtime.customSimulator!==undefined)validateCustomSimulator(profile.runtime.customSimulator);
 validatePracticeControls(profile.practiceControls);
 if(profile.practiceInput!==undefined&&(!profile.practiceInput||![0,1].includes(profile.practiceInput.driverPort)))throw Error('practiceInput.driverPort must be 0 or 1');
 if(!Array.isArray(profile.calibration))throw Error('Missing calibration ledger');
 const subjects=new Set();for(const item of profile.calibration){
  if(typeof item.subject!=='string'||!item.subject||subjects.has(item.subject)||!['derived','measured','reviewed','estimated','unknown'].includes(item.status)||typeof item.evidence!=='string'||!item.evidence.trim())throw Error('Invalid calibration entry');subjects.add(item.subject);
 }
 return {profile,profilePath,root,build:resolve(profile.build),cad:{robot:resolve(profile.cad?.robot),field:resolve(profile.cad?.field)},runtime:{adapter:profile.runtime.adapter,project:resolve(profile.runtime.project),jar:resolve(profile.runtime.jar),nativeLibraries:resolve(profile.runtime.nativeLibraries)}};
}

export async function auditRobotProject(project){
 const errors=[],review=project.profile.calibration.filter(p=>['estimated','unknown'].includes(p.status));
 const required=['CAD geometry and occurrence bindings','Motor ratios and frame directions','Mass, inertia and center of gravity','Tire, fuel and mechanism contact behavior','Complete mechanism articulation and sensors','Full-match hardware comparison'];
 for(const subject of required)if(!project.profile.calibration.some(p=>p.subject===subject))review.push({subject,status:'unknown',evidence:'No assessment supplied'});
 let summary={},sourceFreshness={status:'unknown',files:0};
 try{
  const bytes=Buffer.from(await Bun.file(path.join(project.build,'world.json')).arrayBuffer()),world=JSON.parse(bytes),scene=await Bun.file(path.join(project.build,'scene-bindings.json')).json();
  validateSceneBindings(scene);
  validateBindingAxes(scene,world);
  sourceFreshness=await verifySourceInputs(project,scene.sourceInputs);errors.push(...sourceFreshness.errors);
  if(scene.worldHash!==hash(bytes))errors.push('World and scene bindings are different builds');
  if(world.gameplay&&(project.profile.physicsMode?.name!=='gameplay'||!project.profile.physicsMode?.settings?.gameplay))errors.push('Reduced-order mechanisms require an explicit gameplay profile');
  if(project.profile.physicsMode){
   const mode=project.profile.physicsMode;
   if(mode.worldHash!==hash(bytes)||!/^[a-f0-9]{64}$/.test(mode.sourceWorldHash??''))errors.push('Physics mode provenance does not match compiled world');
   if(mode.name==='accurate'&&mode.sourceWorldHash!==mode.worldHash)errors.push('Accurate mode must preserve source world bytes');
   for(const [key,value] of Object.entries(mode.settings??{})){
    if(key==='fieldFoamSubdivisions'){
     const foam=world.bodies.filter(b=>b.compliance);
     if(!world.gameplay?.field_compliance||!Number.isInteger(value)||value<0||value>2||!foam.length||foam.some(b=>b.compliance.subdivisions!==value))errors.push('Physics mode setting mismatch: '+key);
    }else if(JSON.stringify(world[key])!==JSON.stringify(value))errors.push('Physics mode setting mismatch: '+key);
   }
  }
  const unique=(list,label)=>{if(!Array.isArray(list))throw Error('Missing '+label);const result=new Set();for(const item of list){if(typeof item.id!=='string'||!item.id||result.has(item.id))errors.push('Invalid/duplicate '+label+' ID: '+item.id);result.add(item.id);}return result;};
  const bodies=unique(world.bodies,'body'),joints=unique(world.joints,'joint'),motors=unique(world.motors,'motor');
  if(!bodies.has('chassis'))errors.push('Current viewer/gyro adapter requires a root body named chassis');
  for(const joint of world.joints){if(!bodies.has(joint.parent)||!bodies.has(joint.child))errors.push('Unbound joint '+joint.id);}
  for(const motor of world.motors){if(!joints.has(motor.joint))errors.push('Unbound motor '+motor.id);if(!Number.isFinite(motor.rotor_per_unit)||motor.rotor_per_unit===0)errors.push('Missing/nonfinite motor ratio '+motor.id);}
  for(const [id,volts] of Object.entries(world.field_drives||{}))if(!motors.has(id)||!Number.isFinite(volts)||Math.abs(volts)>12)errors.push('Invalid field drive '+id);
  for(const [kind,root] of Object.entries(project.cad)){
   const assembly=await Bun.file(path.join(root,'assembly.json')).json(),instances=await Bun.file(path.join(root,'instances.json')).json();
   if(assembly.sourceHash!==scene[kind==='robot'?'sourceHash':'fieldSourceHash'])errors.push(kind+' CAD revision does not match compiled bindings');
   const ids=new Set(instances.map(n=>n.id));
   for(const [id,binding] of Object.entries(scene[kind]||{})){if(!ids.has(id)||!bodies.has(binding.body))errors.push('Invalid '+kind+' occurrence binding '+id);}
   if(kind==='robot')for(const id of ids)if(!scene.robot?.[id])errors.push('Unassigned CAD part '+id);
  }
  summary={worldHash:hash(bytes),bodies:bodies.size,joints:joints.size,motors:motors.size,robotMotors:world.motors.filter(m=>!(m.id in (world.field_drives||{}))).length};
 }catch(error){errors.push(error.message);}
 return {schema:1,projectId:project.profile.id,canLoad:errors.length===0,errors,sourceFreshness,reviewRequired:review,
  // A clean artifact audit cannot certify real hardware fidelity.
  qualification:'not-certified',scope:'Artifact/binding consistency and declared assumptions; hardware calibration remains separate',...summary};
}
