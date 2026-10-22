import {compileBeltSurfaces} from './belt-motion.js';
// Rotary mechanism trees. Joint frames use the assembled CAD pose in mm/degrees.
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
    if(typeof j.id!=='string'||!j.id||joints.has(j.id)||j.type!=='revolute'||!bodies.has(j.parent)||j.parent===j.child||!bodies.has(j.child)||bodies.get(j.child).fixed||children.has(j.child)||!vector(j.origin)||!vector(j.axis)||Math.abs(Math.hypot(...j.axis)-1)>1e-6) fail('Expected unique revolute joints between bodies with unit axes');
    j.bindAngleDeg??=0;if(!finite(j.bindAngleDeg))fail('Invalid bind angle');
    if(j.limitsDeg&&(!Array.isArray(j.limitsDeg)||j.limitsDeg.length!==2||!j.limitsDeg.every(finite)||j.limitsDeg[0]>=j.limitsDeg[1]||j.bindAngleDeg<j.limitsDeg[0]||j.bindAngleDeg>j.limitsDeg[1]))fail('Invalid joint limits');
    children.add(j.child);joints.set(j.id,j);
  }
  for(const b of m.bodies)if(!b.fixed&&!children.has(b.id))fail('Moving body has no joint: '+b.id);
  // Each moving body has one parent; require every chain to reach a fixed root.
  // Iterative traversal supports deep assemblies and rejects disconnected cycles.
  const descendants=new Map();
  for(const j of m.joints){if(!descendants.has(j.parent))descendants.set(j.parent,[]);descendants.get(j.parent).push(j.child);}
  const reached=m.bodies.filter(b=>b.fixed).map(b=>b.id);
  for(let i=0;i<reached.length;i++)reached.push(...(descendants.get(reached[i])??[]));
  if(reached.length!==m.bodies.length)fail('Body hierarchy contains a cycle or lacks a fixed root');
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
  compileBeltSurfaces(m);
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
function compose(parent,local){
  const out=[];
  for(let row=0;row<3;row++)for(let col=0;col<4;col++){
    let value=col===3?parent[row*4+3]:0;
    for(let k=0;k<3;k++)value+=parent[row*4+k]*local[k*4+col];
    out.push(value);
  }
  return out;
}
export function mechanismPose(m, part, degrees, previous={}) {
  if(!finite(degrees))fail('Angle must be finite');
  let root=resolveJoint(m,part),angle=degrees;
  const incoming=new Map(m.relations.map(r=>[r.follower,r]));
  while(incoming.has(root)){const r=incoming.get(root);angle=(angle-r.phaseDeg)/r.ratio;root=r.driver;}
  const angles=Object.fromEntries(m.joints.map(j=>[j.id,previous[j.id]??j.bindAngleDeg]));angles[root]=angle;
  const visit=id=>{for(const r of m.relations.filter(r=>r.driver===id)){angles[r.follower]=angles[id]*r.ratio+r.phaseDeg;visit(r.follower);}};visit(root);
  const transforms={},bodyTransforms=new Map(),descendants=new Map(),queue=[];
  for(const b of m.bodies)if(b.fixed){queue.push(b.id);bodyTransforms.set(b.id,identityTransform());}
  for(const j of m.joints){
    const q=angles[j.id];if(!finite(q)||j.limitsDeg&&(q<j.limitsDeg[0]||q>j.limitsDeg[1]))fail('Joint limit exceeded: '+j.id);
    if(!descendants.has(j.parent))descendants.set(j.parent,[]);descendants.get(j.parent).push(j);
  }
  for(let i=0;i<queue.length;i++)for(const j of descendants.get(queue[i])??[]){
    // Both the mesh and joint frame are expressed in the assembled CAD pose.
    // The parent's delta carries the child's axle along with its own rotation.
    bodyTransforms.set(j.child,compose(bodyTransforms.get(j.parent),rotation(j.origin,j.axis,angles[j.id]-j.bindAngleDeg)));
    queue.push(j.child);
  }
  for(const b of m.bodies)for(const id of b.parts)transforms[id]=bodyTransforms.get(b.id);
  return {angles,transforms};
}
