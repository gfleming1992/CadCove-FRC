import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validatePhysicalModel,physicalDependencies} from '../vendor/cad-core/src/core/physical-model.js';
import {compileMechanism} from './mechanism-export.js';
export {validatePhysicalModel,physicalDependencies};
// Legacy rotary mechanisms are normalized through their existing checked exporter.
export function physicalModel(definition,parts,initialAngles){
 if(definition.physical||definition.units==='m-kg-s-rad')return validatePhysicalModel(definition.physical??definition,parts);
 const {world}=compileMechanism(definition,parts,initialAngles),byId=new Map(definition.bodies.map(b=>[b.id,b]));
 return validatePhysicalModel({schema:1,units:'m-kg-s-rad',gravity:world.gravity,complianceZones:definition.complianceZones,
  bodies:world.bodies.map(b=>{const authored=byId.get(b.id),p=authored.physics;return {id:b.id,parts:authored.parts,fixed:b.fixed,cadFrame:{position:authored.origin.map(x=>x/1000),rotation:[0,0,0]},position:b.position,rotation:b.rotation??[0,0,0],inertial:{mass:p.massKg,center:p.centerOfMassMm.map(x=>x/1000),tensor:[...p.principalInertiaKgMm2.map(x=>x*1e-6),0,0,0]},compliance:p.compliance,collision:{friction:b.friction,restitution:b.restitution??0,shapes:b.colliders.map(s=>s.kind==='cylinder'?{kind:s.kind,center:s.center,radius:s.radius,halfHeight:s.half_height,rotation:s.rotation}:s.kind==='mesh_file'?{kind:s.kind,file:s.file,sha256:s.sha256,cooking:s.cooking,center:s.position,rotation:s.rotation}:s),disabled:!b.colliders.length,membership:b.membership,filter:b.filter},source:p.source,provenance:{status:'estimated',evidence:p.provenance}};}),
  joints:world.joints.map(j=>({id:j.id,type:j.kind,parent:j.parent,child:j.child,axis:j.axis,anchorParent:j.anchor_parent,anchorChild:j.anchor_child,position:j.initial_position,damping:j.damping,limits:j.limits,contactsEnabled:j.contacts_enabled??false})),
  transmissions:world.transmissions.map(t=>({id:t.id,driver:t.driver,follower:t.follower,ratio:t.ratio,phase:t.phase,stiffness:t.stiffness,damping:t.damping,maxEffort:t.max_effort})),
  motors:world.motors.map(m=>({id:m.id,joint:m.joint,rotorPerUnit:m.rotor_per_unit,efficiency:m.efficiency,resistance:m.resistance,torqueConstant:m.torque_constant,velocityConstant:m.velocity_constant,currentLimit:m.current_limit}))},parts);
}
export function nativeSphereCompliance(c){return {frequency_hz:c.frequencyHz,subdivisions:c.subdivisions,entry_margin:c.entryMargin,exit_margin:c.exitMargin,recovery_tolerance:c.recoveryTolerance};}
export function compilePhysicalModel(value){
 const m=validatePhysicalModel(value);
 return {dt:.005,gravity:m.gravity,solver_iterations:8,compliance_zones:(m.complianceZones??[]).map(z=>({...z})),
  bodies:m.bodies.map(b=>({id:b.id,fixed:b.fixed,position:b.position,rotation:b.rotation,mass:b.inertial.mass,...(b.compliance?{compliance:nativeSphereCompliance(b.compliance)}:{center_of_mass:b.inertial.center,inertia_tensor:b.inertial.tensor}),friction:b.collision.friction,restitution:b.collision.restitution,membership:b.collision.membership,filter:b.collision.filter,colliders:b.collision.shapes.map(s=>s.kind==='cylinder'?{kind:s.kind,center:s.center,radius:s.radius,half_height:s.halfHeight,rotation:s.rotation}:s.kind==='mesh_file'?{kind:s.kind,file:s.file,sha256:s.sha256,cooking:s.cooking,position:s.center,rotation:s.rotation}:s)})),
  joints:m.joints.map(j=>({id:j.id,kind:j.type,parent:j.parent,child:j.child,axis:j.axis,anchor_parent:j.anchorParent,anchor_child:j.anchorChild,initial_position:j.position,damping:j.damping,limits:j.limits,contacts_enabled:j.contactsEnabled})),
  transmissions:(m.transmissions??[]).map(t=>({id:t.id,driver:t.driver,follower:t.follower,ratio:t.ratio,phase:t.phase,stiffness:t.stiffness,damping:t.damping,max_effort:t.maxEffort})),
  motors:(m.motors??[]).map(x=>({id:x.id,joint:x.joint,rotor_per_unit:x.rotorPerUnit,efficiency:x.efficiency,resistance:x.resistance,torque_constant:x.torqueConstant,velocity_constant:x.velocityConstant,current_limit:x.currentLimit}))};
}
export function physicalSubset(model,ids){
 const bodies=new Set(ids),joints=model.joints.filter(j=>bodies.has(j.parent)&&bodies.has(j.child)),jointIds=new Set(joints.map(j=>j.id));
 return {...model,complianceZones:(model.complianceZones??[]).filter(z=>bodies.has(z.body)),bodies:model.bodies.filter(b=>bodies.has(b.id)),joints,transmissions:(model.transmissions??[]).filter(t=>jointIds.has(t.driver)&&jointIds.has(t.follower)),motors:(model.motors??[]).filter(x=>jointIds.has(x.joint))};
}

// Validate immutable collider bytes before spawning native work. Native loading
// independently rechecks SHA-256. Symlinks must resolve inside the workspace.
export async function validatePhysicalAssets(world,{assetRoot}={}){
 const shapes=world.bodies.flatMap(b=>b.colliders??[]).filter(s=>s.kind==='mesh_file');
 if(!shapes.length)return [];if(!assetRoot)throw Error('Mesh colliders require an explicit workspace assetRoot');
 const root=await fs.realpath(assetRoot),checked=[];
 for(const s of shapes){
  if(typeof s.file!=='string'||s.file.includes('\\')||s.file.includes(':')||s.file.split('/').some(p=>!p||p==='.'||p==='..')||!s.file.endsWith('.ctm')||! /^[a-f0-9]{64}$/.test(s.sha256??''))throw Error('Invalid pinned mesh asset path or hash');
  const file=await fs.realpath(path.resolve(root,s.file)),relative=path.relative(root,file);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Mesh collider must remain inside workspace: '+s.file);
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size>128*1024*1024)throw Error('Mesh collider must be a file at most128MiB');
  const bytes=await fs.readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==s.sha256)throw Error('Mesh collider hash mismatch: '+s.file);
  if(bytes.length<12||bytes.subarray(0,4).toString()!=='CTM1')throw Error('Invalid CTM1 collider header');
  const vertices=bytes.readUInt32LE(4),triangles=bytes.readUInt32LE(8);
  if(vertices<3||vertices>2000000||triangles<1||triangles>4000000||bytes.length!==12+12*(vertices+triangles))throw Error('Invalid CTM1 collider counts or length');
  for(let i=12;i<12+vertices*12;i+=4)if(!Number.isFinite(bytes.readFloatLE(i)))throw Error('Nonfinite CTM1 collider vertex');
  for(let i=12+vertices*12;i<bytes.length;i+=4)if(bytes.readUInt32LE(i)>=vertices)throw Error('CTM1 collider index outside vertices');
  checked.push({file:s.file,sha256:s.sha256,vertices,triangles,cooking:s.cooking});
 }return checked;
}
