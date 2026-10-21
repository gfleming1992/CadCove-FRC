// Generic fixed-base rotary mechanisms. CAD units are mm/degrees; no FRC types.
const fail = message => { throw Error(message); };
const finite = x => typeof x === 'number' && Number.isFinite(x);
const vector = v => Array.isArray(v) && v.length === 3 && v.every(finite);
export const identityTransform = () => [1,0,0,0,0,1,0,0,0,0,1,0];
export function validateMechanism(value, partIds) {
  const m = structuredClone(value);
  if(m?.schema!==1 || m.units!=='mm-deg' || !Array.isArray(m.bodies) || !Array.isArray(m.joints) || !Array.isArray(m.relations)) fail('Expected mechanism schema 1, units mm-deg, bodies, joints and relations');
  if(m.bodies.length>10000 || m.joints.length>10000) fail('Mechanism is too large');
  const bodies=new Map(),joints=new Map(),owners=new Map(),children=new Set(),incoming=new Map();
  for(const b of m.bodies){
    if(typeof b.id!=='string'||!b.id||bodies.has(b.id)||!vector(b.origin)||typeof b.fixed!=='boolean'||!Array.isArray(b.parts)||!b.parts.length) fail('Invalid or duplicate rigid body');
    for(const id of b.parts){if(typeof id!=='string'||owners.has(id)||(partIds&&!partIds.includes(id))) fail('Unknown or multiply owned part '+id);owners.set(id,b.id);}
    bodies.set(b.id,b);
  }
  for(const j of m.joints){
    if(typeof j.id!=='string'||!j.id||joints.has(j.id)||j.type!=='revolute'||!bodies.get(j.parent)?.fixed||!bodies.has(j.child)||bodies.get(j.child).fixed||children.has(j.child)||!vector(j.origin)||!vector(j.axis)||Math.abs(Math.hypot(...j.axis)-1)>1e-6) fail('Expected unique revolute joints from a fixed base with unit axes');
    j.bindAngleDeg??=0;if(!finite(j.bindAngleDeg))fail('Invalid bind angle');
    if(j.limitsDeg&&(!Array.isArray(j.limitsDeg)||j.limitsDeg.length!==2||!j.limitsDeg.every(finite)||j.limitsDeg[0]>=j.limitsDeg[1]||j.bindAngleDeg<j.limitsDeg[0]||j.bindAngleDeg>j.limitsDeg[1]))fail('Invalid joint limits');
    children.add(j.child);joints.set(j.id,j);
  }
  for(const b of m.bodies)if(!b.fixed&&!children.has(b.id))fail('Moving body has no joint: '+b.id);
  const relationIds=new Set();
  for(const r of m.relations){
    if(typeof r.id!=='string'||relationIds.has(r.id)||!['gear','belt','chain'].includes(r.type)||!joints.has(r.driver)||!joints.has(r.follower)||r.driver===r.follower||incoming.has(r.follower)||![r.driverTeeth,r.followerTeeth].every(n=>Number.isSafeInteger(n)&&n>0)||![1,-1].includes(r.direction))fail('Invalid rotary relation');
    r.phaseDeg??=0;if(!finite(r.phaseDeg))fail('Invalid relation phase');
    r.ratio=r.direction*r.driverTeeth/r.followerTeeth;
    if(Math.abs(joints.get(r.follower).bindAngleDeg-r.ratio*joints.get(r.driver).bindAngleDeg-r.phaseDeg)>1e-6)fail('Relation phase contradicts bind angles');
    incoming.set(r.follower,r);relationIds.add(r.id);
  }
  for(const j of m.joints){let id=j.id;const visited=new Set();while(incoming.has(id)){if(visited.has(id))fail('Closed-loop relations are not supported');visited.add(id);id=incoming.get(id).driver;}}
  const motorIds=new Set();for(const motor of m.motors??[]){if(typeof motor.id!=='string'||motorIds.has(motor.id)||!joints.has(motor.joint))fail('Invalid motor shaft binding');motorIds.add(motor.id);}
  return m;
}
export function resolveJoint(m, id) {
  const direct=m.joints.find(j=>j.id===id);if(direct)return direct.id;
  const motor=m.motors?.find(v=>v.id===id);if(motor)return motor.joint;
  const b=m.bodies.find(b=>b.id===id||b.parts.includes(id));
  const j=m.joints.find(j=>j.child===b?.id);if(!j)fail('No rotary joint for '+id);return j.id;
}
function rotation(origin,axis,degrees){
  const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),t=1-c,[x,y,z]=axis;
  const rows=[[t*x*x+c,t*x*y-s*z,t*x*z+s*y],[t*x*y+s*z,t*y*y+c,t*y*z-s*x],[t*x*z-s*y,t*y*z+s*x,t*z*z+c]];
  return rows.flatMap((row,i)=>[...row,origin[i]-row.reduce((v,n,k)=>v+n*origin[k],0)]);
}
export function mechanismPose(m, part, degrees, previous={}) {
  if(!finite(degrees))fail('Angle must be finite');
  let root=resolveJoint(m,part),angle=degrees;
  const incoming=new Map(m.relations.map(r=>[r.follower,r]));
  while(incoming.has(root)){const r=incoming.get(root);angle=(angle-r.phaseDeg)/r.ratio;root=r.driver;}
  const angles=Object.fromEntries(m.joints.map(j=>[j.id,previous[j.id]??j.bindAngleDeg]));angles[root]=angle;
  const visit=id=>{for(const r of m.relations.filter(r=>r.driver===id)){angles[r.follower]=angles[id]*r.ratio+r.phaseDeg;visit(r.follower);}};visit(root);
  const transforms={};for(const b of m.bodies)for(const id of b.parts)transforms[id]=identityTransform();
  for(const j of m.joints){const q=angles[j.id];if(!finite(q)||j.limitsDeg&&(q<j.limitsDeg[0]||q>j.limitsDeg[1]))fail('Joint limit exceeded: '+j.id);const matrix=rotation(j.origin,j.axis,q-j.bindAngleDeg);for(const id of m.bodies.find(b=>b.id===j.child).parts)transforms[id]=matrix;}
  return {angles,transforms};
}
