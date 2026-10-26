import assert from 'node:assert/strict';
import path from 'node:path';
import {compose,rotation,axisAngle,point,translation} from './transforms.js';

// Explicit body membership avoids guessing which CAD belongs to the field.
// This first runner instantiates copies of one validated robot package.
export function composeMatchWorld(source,{robotBodyIds,spawns}) {
 assert(spawns.length>=2&&spawns.length<=6,'A match needs 2–6 robots');
 assert(spawns.every(s=>Array.isArray(s.position)&&s.position.length===3&&s.position.every(Number.isFinite)&&(s.yaw===undefined||Number.isFinite(s.yaw))),'Invalid robot spawn');
 const bodyIds=new Set(robotBodyIds),sourceBodies=new Map(source.bodies.map(b=>[b.id,b]));
 assert(bodyIds.has('chassis')&&[...bodyIds].every(id=>sourceBodies.has(id)),'Invalid robot body set');
 assert(source.gameplay&&!source.robot_gameplay,'Use a single-robot gameplay package');
 assert(!source.mechanisms?.length,'Custom mechanism namespacing is not yet supported');
 const jointIds=new Set(source.joints.filter(j=>bodyIds.has(j.parent)&&bodyIds.has(j.child)).map(j=>j.id));
 assert(source.joints.every(j=>bodyIds.has(j.parent)===bodyIds.has(j.child)),'Robot cannot be jointed to the field');
 const motorIds=new Set(source.motors.filter(m=>jointIds.has(m.joint)).map(m=>m.id));
 const transmissionIds=new Set(source.transmissions.filter(t=>jointIds.has(t.driver)&&jointIds.has(t.follower)).map(t=>t.id));
 assert(source.transmissions.every(t=>jointIds.has(t.driver)===jointIds.has(t.follower)),'Robot cannot transmit to the field');
 const ids=new Set([...bodyIds,...jointIds,...motorIds,...transmissionIds]);
 const allRobotBits=spawns.reduce((a,_,i)=>a|(1<<(i+3)),0);
 const checkAssets=v=>{
  if(Array.isArray(v))return v.map(checkAssets);
  if(!v||typeof v!=='object')return v;
  const out=Object.fromEntries(Object.entries(v).map(([k,x])=>[k,checkAssets(x)]));
  if(out.kind==='mesh_file')assert(!path.isAbsolute(out.file),'Collider paths must be relative to the shared asset root');
  return out;
 };
 const base=checkAssets(structuredClone(source));
 assert(['bodies','joints','motors','transmissions'].every(key=>base[key].every(v=>!/^r[0-5]\//.test(v.id))),'Reserved robot namespace');
 const combined=structuredClone(base);combined.robot_gameplay={};
 for(const [key,set] of [['bodies',bodyIds],['joints',jointIds],['motors',motorIds],['transmissions',transmissionIds]])combined[key]=base[key].filter(v=>!set.has(v.id));
 combined.compliance_zones=(base.compliance_zones||[]).filter(z=>!bodyIds.has(z.body));
 for(const b of combined.bodies){
  if(b.filter!==undefined)b.filter=(b.filter&~1)|((b.filter&1)?allRobotBits:0);
 }
 const origin=sourceBodies.get('chassis').position;
 const robots=spawns.map((spawn,i)=>{
  const id='r'+i,prefix=id+'/',bit=1<<(i+3);
  const rename=v=>typeof v==='string'?(ids.has(v)?prefix+v:v):Array.isArray(v)?v.map(rename):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rename(x)])):v;
  const pose=compose(translation(spawn.position),compose(rotation([0,0,1],spawn.yaw||0),translation(origin.map(x=>-x))));
  const localWorld=structuredClone(base);
  for(const b of localWorld.bodies)if(bodyIds.has(b.id)){
   b.position=point(pose,b.position);
   const r=b.rotation||[0,0,0],angle=Math.hypot(...r),matrix=rotation(angle?r.map(x=>x/angle):[0,0,1],angle);
   b.rotation=axisAngle(compose(rotation([0,0,1],spawn.yaw||0),matrix));
   for(const key of ['velocity','angular_velocity'])if(b[key])b[key]=point(rotation([0,0,1],spawn.yaw||0),b[key]);
   const copy=rename(b);
   assert(b.membership===1&&b.filter===6,'This runner requires robot group 1 with field/ball filters 6');
   copy.membership=bit;copy.filter=6|(allRobotBits&~bit);
   combined.bodies.push(copy);
  }
  for(const [key,set] of [['joints',jointIds],['motors',motorIds],['transmissions',transmissionIds]])combined[key].push(...base[key].filter(v=>set.has(v.id)).map(rename));
  combined.compliance_zones.push(...(base.compliance_zones||[]).filter(z=>bodyIds.has(z.body)).map(rename));
  const g=rename(base.gameplay);if(i===0)combined.gameplay=g;else{g.field_conveyors=[];combined.robot_gameplay[id]=g;}
  return {id,prefix,world:localWorld,bodyIds:[...bodyIds],jointIds:[...jointIds],motorIds:[...motorIds],transmissionIds:[...transmissionIds],spawn};
 });
 return {world:combined,robots};
}
