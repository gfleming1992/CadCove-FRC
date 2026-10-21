import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {snapshot} from '../vendor/cad-core/src/core/revision.js';
import {validateMechanism} from '../vendor/cad-core/src/core/mechanism.js';
import {cadProjectSettings} from './cad-project.js';
import {cadFeedback} from './cad-feedback.js';
import {readSources,relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const vec=x=>Array.isArray(x)&&x.length===3&&x.every(finite);
const scale=v=>v.map(n=>n/1000);
function physicsBody(b){
 const p=b.physics;
 if(!p||!finite(p.massKg)||p.massKg<=0||!vec(p.centerOfMassMm)||!vec(p.principalInertiaKgMm2)||p.principalInertiaKgMm2.some(n=>n<=0)||!finite(p.friction)||p.friction<0||!Array.isArray(p.colliders)||!p.colliders.length||typeof p.provenance!=='string'||!p.provenance.trim())throw Error('Explicit mass, principal inertia, center of mass, friction, colliders and provenance required: '+b.id);
 const colliders=p.colliders.map(c=>{
  if(!vec(c.centerMm))throw Error('Collider center required');
  if(c.kind==='box'&&vec(c.halfMm)&&c.halfMm.every(n=>n>0))return {kind:'box',half:scale(c.halfMm),center:scale(c.centerMm)};
  if(c.kind==='cylinder'&&finite(c.radiusMm)&&c.radiusMm>0&&finite(c.halfHeightMm)&&c.halfHeightMm>0&&vec(c.rotationRad))return {kind:'cylinder',radius:c.radiusMm/1000,half_height:c.halfHeightMm/1000,center:scale(c.centerMm),rotation:c.rotationRad};
  throw Error('Unsupported or invalid collider');
 });
 return {id:b.id,fixed:b.fixed,position:scale(b.origin),mass:p.massKg,center_of_mass:scale(p.centerOfMassMm),principal_inertia:p.principalInertiaKgMm2.map(x=>x*1e-6),friction:p.friction,colliders};
}
export function compileMechanism(value,parts){
 const m=validateMechanism(value,parts),bodies=m.bodies.map(physicsBody),byId=new Map(m.bodies.map(b=>[b.id,b]));
 const joints=m.joints.map(j=>{
  if(!finite(j.damping)||j.damping<0)throw Error('Explicit joint damping required: '+j.id);
  return {id:j.id,parent:j.parent,child:j.child,kind:'revolute',axis:j.axis,anchor_parent:scale(j.origin.map((x,i)=>x-byId.get(j.parent).origin[i])),anchor_child:scale(j.origin.map((x,i)=>x-byId.get(j.child).origin[i])),initial_position:j.bindAngleDeg*Math.PI/180,limits:j.limitsDeg?.map(x=>x*Math.PI/180),damping:j.damping};
 });
 const transmissions=m.relations.map(r=>{
  const p=r.physics;if(!p||!['stiffness','damping','maxEffort'].every(k=>finite(p[k])&&p[k]>=0)||p.stiffness===0||p.maxEffort===0)throw Error('Explicit transmission compliance and effort required: '+r.id);
  return {id:r.id,driver:r.driver,follower:r.follower,ratio:r.ratio,phase:r.phaseDeg*Math.PI/180,stiffness:p.stiffness,damping:p.damping,max_effort:p.maxEffort};
 });
 const motors=(m.motors??[]).map(motor=>{
  const p=motor.physics;if(!p||!['rotorPerUnit','efficiency','resistance','torqueConstant','velocityConstant','currentLimit'].every(k=>finite(p[k])&&p[k]>0)||p.efficiency>1)throw Error('Explicit motor electrical parameters required: '+motor.id);
  return {id:motor.id,joint:motor.joint,rotor_per_unit:p.rotorPerUnit,efficiency:p.efficiency,resistance:p.resistance,torque_constant:p.torqueConstant,velocity_constant:p.velocityConstant,current_limit:p.currentLimit};
 });
 const bindings=Object.fromEntries(m.bodies.flatMap(b=>b.parts.map(id=>[id,{body:b.id,local:[1,0,0,-b.origin[0]/1000,0,1,0,-b.origin[1]/1000,0,0,1,-b.origin[2]/1000]}])));
 return {world:{dt:0.005,gravity:[0,0,0],solver_iterations:8,bodies,joints,transmissions,motors},bindings,provenance:m.bodies.map(b=>({body:b.id,evidence:b.physics.provenance})),scope:'Fixed-base rotary mechanisms; compliant ratio constraints and declared collision approximations, not tooth-contact or flexible belt/chain simulation'};
}
export async function exportMechanism(options){
 if(!options.output)throw Error('--output NEW_DIRECTORY is required');
 const root=path.resolve(options.workspace??process.cwd()),settings=await cadProjectSettings(root),entry=options.entry??settings.entryPoint;relativePath(entry);
 const feedback=await cadFeedback(root,{entry});if(!feedback.ok)throw Error('Build current CAD successfully before exporting its mechanism');
 const source=path.join(root,settings.sourceDirectory),files=await readSources(source,path.join(root,settings.buildDirectory)),file=path.posix.join(path.posix.dirname(entry),'mechanism.json');
 if((await snapshot(files,entry,feedback.runtime)).revision!==feedback.sourceRevision)throw Error('CAD source changed during export');
 if(!files[file])throw Error('Missing '+file);
 const compiled=compileMechanism(JSON.parse(files[file]),feedback.parts.map(p=>p.id));
 // Refuse unmapped parts, rather than silently lose CAD occurrences in physics.
 for(const p of feedback.parts)if(!compiled.bindings[p.id])throw Error('Part lacks rigid body: '+p.id);
 const worldText=JSON.stringify(compiled.world,null,2)+'\n',worldHash=hash(worldText);
 const sourceInputs={root:'project',schema:1,files:Object.entries(files).map(([file,text])=>({file:path.posix.join(settings.sourceDirectory,file),sha256:/\.(step|stp|brep)$/i.test(file)&&text.startsWith('sha256:')?text.slice(7):hash(text)}))};
 const latest=await cadFeedback(root,{entry});if(!latest.ok||latest.sourceRevision!==feedback.sourceRevision)throw Error('CAD source changed during export');
 const output=path.resolve(options.output);await fs.mkdir(output,{recursive:false});
 await fs.writeFile(path.join(output,'world.json'),worldText);
 await fs.writeFile(path.join(output,'scene-bindings.json'),JSON.stringify({schema:1,worldHash,sourceRevision:feedback.sourceRevision,sourceInputs,robot:compiled.bindings,field:{},start:[0,0,0],fieldOrigin:[0,0,0]},null,2)+'\n');
 await fs.writeFile(path.join(output,'mechanism-report.json'),JSON.stringify({schema:1,scope:compiled.scope,provenance:compiled.provenance},null,2)+'\n');
 return {ok:true,output,worldHash,sourceRevision:feedback.sourceRevision,bodies:compiled.world.bodies.length,joints:compiled.world.joints.length,transmissions:compiled.world.transmissions.length,motors:compiled.world.motors.length,scope:compiled.scope};
}
