// Engine-independent physical description. SI units and body-local inertial /
// collision frames follow SDFormat semantics; this JSON is not an SDF parser.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const vec=(x,n=3)=>Array.isArray(x)&&x.length===n&&x.every(finite);
const fail=s=>{throw Error(s);};
const fields=(o,keys,label)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))fail('Unsupported '+label+' fields');};
export function validatePhysicalModel(value,partIds){
 const m=structuredClone(value);
 fields(m,['schema','units','bodies','joints','transmissions','motors','gravity','provenance','complianceZones'],'physical model');
 if(m.schema!==1||m.units!=='m-kg-s-rad'||!Array.isArray(m.bodies)||!m.bodies.length||m.bodies.length>10000||!Array.isArray(m.joints))fail('Expected physical schema 1, SI units, bodies and joints');
 m.gravity??=[0,0,-9.80665];if(!vec(m.gravity))fail('Invalid gravity');
 const bodies=new Map(),owners=new Set(),joints=new Map();
 for(const b of m.bodies){
  fields(b,['id','parts','fixed','position','rotation','inertial','collision','provenance','source','cadFrame','compliance'],'body');
  if(typeof b.id!=='string'||!b.id||bodies.has(b.id)||typeof b.fixed!=='boolean'||!vec(b.position)||!Array.isArray(b.parts))fail('Invalid physical body');
  b.rotation??=[0,0,0];if(!vec(b.rotation))fail('Invalid body rotation vector');
  b.cadFrame??={position:[...b.position],rotation:[...b.rotation]};fields(b.cadFrame,['position','rotation'],'CAD bind frame');if(!vec(b.cadFrame.position)||!vec(b.cadFrame.rotation))fail('Invalid CAD bind frame');
  for(const id of b.parts){if(typeof id!=='string'||owners.has(id)||(partIds&&!partIds.includes(id)))fail('Unknown or multiply owned CAD part '+id);owners.add(id);}
  fields(b.inertial,['mass','center','tensor'],'inertial');
  const {mass,center,tensor:t}=b.inertial;
  if(!finite(mass)||mass<=0||!vec(center)||!vec(t,6))fail('Explicit mass, center and symmetric inertia tensor required: '+b.id);
  // Tensor order xx, yy, zz, xy, xz, yz, about COM in the body frame.
  const [a,bv,c,d,e,f]=t,det=a*bv*c+2*d*e*f-a*f*f-bv*e*e-c*d*d;
  if(a<=0||a*bv-d*d<=0||det<=0)fail('Inertia must be positive definite: '+b.id);
  // A physical inertia has a positive-semidefinite second-moment matrix.
  const h=(a+bv+c)/2,x=h-a,y=h-bv,z=h-c,eps=Math.max(a,bv,c)*1e-9;
  if(Math.min(x,y,z)<-eps||x*y-d*d < -eps*eps||x*z-e*e < -eps*eps||y*z-f*f < -eps*eps||x*y*z-2*d*e*f-x*f*f-y*e*e-z*d*d < -eps*eps*eps)fail('Inertia violates mass distribution inequalities: '+b.id);
  fields(b.collision,['shapes','friction','restitution','membership','filter','disabled'],'collision');
  const collision=b.collision;
  if(!finite(collision.friction)||collision.friction<0||!finite(collision.restitution)||collision.restitution<0||collision.restitution>1||!Array.isArray(collision.shapes)||(!collision.shapes.length&&collision.disabled!==true))fail('Explicit contact properties and collision shapes required: '+b.id);
  for(const k of ['membership','filter']){collision[k]??=0xffffffff;if(!Number.isSafeInteger(collision[k])||collision[k]<0||collision[k]>0xffffffff)fail('Invalid collision mask');}
  if(collision.disabled===true){if(collision.shapes.length)fail('Disabled collision must have no shapes');collision.membership=0;collision.filter=0;}
  for(const s of collision.shapes){
   fields(s,s.kind==='mesh_file'?['kind','file','sha256','cooking','center','rotation']:['kind','center','half','radius','halfHeight','rotation'],'collision shape');
   if(!vec(s.center))fail('Collision center must be body-local metres');
   if(s.kind==='box'){if(!vec(s.half)||s.half.some(x=>x<=0)||s.rotation!==undefined)fail('Invalid box half extents or unsupported box rotation');}
   else if(s.kind==='ball'){if(!finite(s.radius)||s.radius<=0||s.rotation!==undefined)fail('Invalid ball radius');}
   else if(s.kind==='cylinder'){if(!finite(s.radius)||s.radius<=0||!finite(s.halfHeight)||s.halfHeight<=0||!vec(s.rotation))fail('Invalid cylinder');}
   else if(s.kind==='mesh_file'){
    if(typeof s.file!=='string'||s.file.includes('\\')||s.file.includes(':')||s.file.split('/').some(p=>!p||p==='.'||p==='..')||!s.file.endsWith('.ctm')||! /^[a-f0-9]{64}$/.test(s.sha256??'')||!vec(s.rotation)||!['trimesh','convex_hull','convex_decomposition','planar_extrusion','cuboid','cuboid_or_mesh'].includes(s.cooking))fail('Invalid pinned mesh collider');
    if(!b.fixed&&['trimesh','cuboid_or_mesh'].includes(s.cooking))fail('Moving mesh collider requires convex cooking');
   }
   else fail('Unsupported collision shape '+s.kind);
  }
  if(!b.provenance||!['derived','measured','reviewed','estimated'].includes(b.provenance.status)||typeof b.provenance.evidence!=='string'||!b.provenance.evidence.trim())fail('Physical property provenance required: '+b.id);
  if(b.source){fields(b.source,['kind','sha256','entities'],'source');if(!['step','cadquery'].includes(b.source.kind)||!/^([a-f0-9]{64})$/.test(b.source.sha256)||!Array.isArray(b.source.entities)||b.source.entities.some(x=>typeof x!=='string'))fail('Invalid source binding');}
  bodies.set(b.id,b);
 }
 if(partIds)for(const id of partIds)if(!owners.has(id))fail('CAD part lacks a physical owner: '+id);
 for(const j of m.joints){
  fields(j,['id','type','parent','child','anchorParent','anchorChild','axis','limits','position','damping','contactsEnabled'],'joint');
  if(typeof j.id!=='string'||!j.id||joints.has(j.id)||!['fixed','revolute','prismatic'].includes(j.type)||!bodies.has(j.parent)||!bodies.has(j.child)||j.parent===j.child||!vec(j.anchorParent)||!vec(j.anchorChild)||!vec(j.axis)||Math.abs(Math.hypot(...j.axis)-1)>1e-6||!finite(j.damping)||j.damping<0)fail('Invalid physical joint');
  j.position??=0;j.contactsEnabled??=false;
  if(!finite(j.position)||typeof j.contactsEnabled!=='boolean'||(j.limits&&(!vec(j.limits,2)||j.limits[0]>=j.limits[1]||j.position<j.limits[0]||j.position>j.limits[1])))fail('Invalid joint position/limits');
  joints.set(j.id,j);
 }
 const ids=new Set();
 for(const r of m.transmissions??[]){
  fields(r,['id','driver','follower','ratio','phase','stiffness','damping','maxEffort'],'transmission');
  if(typeof r.id!=='string'||!r.id||ids.has(r.id)||!joints.has(r.driver)||!joints.has(r.follower)||r.driver===r.follower||joints.get(r.driver).type!==joints.get(r.follower).type||joints.get(r.driver).type==='fixed'||!finite(r.ratio)||r.ratio===0||!finite(r.phase)||!finite(r.stiffness)||r.stiffness<=0||!finite(r.damping)||r.damping<0||!finite(r.maxEffort)||r.maxEffort<=0)fail('Invalid transmission');ids.add(r.id);
 }
 ids.clear();for(const motor of m.motors??[]){
  fields(motor,['id','joint','rotorPerUnit','efficiency','resistance','torqueConstant','velocityConstant','currentLimit'],'motor');
  if(typeof motor.id!=='string'||!motor.id||ids.has(motor.id)||!joints.has(motor.joint)||joints.get(motor.joint).type==='fixed'||!finite(motor.rotorPerUnit)||motor.rotorPerUnit===0||!['efficiency','resistance','torqueConstant','velocityConstant','currentLimit'].every(k=>finite(motor[k])&&motor[k]>0)||motor.efficiency>1)fail('Invalid motor');ids.add(motor.id);
 }
 validateSphereCompliance(m);
 return m;
}

// Optional selective sphere compliance is explicit and independent of labels.
// The material parameters are solver calibration inputs, not a foam inference.
export function validateSphereCompliance(m){
 const f32=x=>finite(x)&&Number.isFinite(Math.fround(x)),positive=x=>f32(x)&&Math.fround(x)>0;
 const compliant=m.bodies.filter(b=>b.compliance!==undefined),byId=new Map(m.bodies.map(b=>[b.id,b]));
 const zones=m.complianceZones??[];
 if(!Array.isArray(zones)||zones.length>1024)fail('Invalid compliance activation zones');
 if(compliant.length&&!zones.length)fail('Compliant spheres require explicit activation zones');
 for(const b of compliant){
  const c=b.compliance;fields(c,['frequencyHz','subdivisions','entryMargin','exitMargin','recoveryTolerance'],'sphere compliance');
  const shapes=b.collision.shapes,s=shapes[0];
  if(b.fixed||shapes.length!==1||s.kind!=='ball'||!vec(s.center)||s.center.some(n=>n!==0)||!positive(s.radius)||b.collision.disabled)fail('Compliance requires one centered dynamic sphere: '+b.id);
  if(m.joints.some(j=>j.parent===b.id||j.child===b.id))fail('Compliant sphere cannot own joints: '+b.id);
  if(!positive(c.frequencyHz)||c.frequencyHz>300||!Number.isInteger(c.subdivisions)||c.subdivisions<0||c.subdivisions>2||!['entryMargin','exitMargin','recoveryTolerance'].every(k=>positive(c[k]))||c.exitMargin<=c.entryMargin||c.recoveryTolerance>=s.radius*.05)fail('Invalid explicit sphere compliance parameters: '+b.id);
  const expected=.4*b.inertial.mass*s.radius*s.radius,tolerance=Math.max(1e-12,expected*1e-6),tensor=b.inertial.tensor;
  if(!positive(expected)||!vec(b.inertial.center)||b.inertial.center.some(n=>n!==0)||!vec(tensor,6)||tensor.some((n,i)=>Math.abs(n-(i<3?expected:0))>tolerance))fail('Compliant sphere requires homogeneous natural inertia and zero COM: '+b.id);
 }
 for(const z of zones){
  fields(z,['body','center','half','lookahead'],'compliance zone');
  if(!byId.has(z.body)||byId.get(z.body).compliance!==undefined||!vec(z.center)||!z.center.every(f32)||!vec(z.half)||!z.half.every(positive)||!finite(z.lookahead)||z.lookahead<.005||z.lookahead>.2)fail('Invalid explicit compliance activation zone');
 }
 return m;
}

export function physicalDependencies(model){
 const m=validatePhysicalModel(model),edges=[],adj=new Map(m.bodies.map(b=>[b.id,new Set()])),byJoint=new Map(m.joints.map(j=>[j.id,j]));
 const roots=new Map(m.bodies.map(b=>[b.id,b.id]));const root=id=>{let at=id;while(roots.get(at)!==at)at=roots.get(at);while(id!==at){const next=roots.get(id);roots.set(id,at);id=next;}return at;};
 const edge=(a,b,kind,id)=>{roots.set(root(a),root(b));adj.get(a).add(b);adj.get(b).add(a);edges.push({from:a,to:b,kind,id});};
 for(const j of m.joints)edge(j.parent,j.child,'joint',j.id);
 for(const [i,z] of (m.complianceZones??[]).entries())for(const b of m.bodies)if(b.compliance)edge(z.body,b.id,'compliance-zone',String(i));
 for(const t of m.transmissions??[])edge(byJoint.get(t.driver).child,byJoint.get(t.follower).child,'transmission',t.id);
 // Potential contacts, not just today's contacts, determine independence. Fixed
 // bodies are included: a changed shared fixture can affect both mechanisms.
 for(let i=0;i<m.bodies.length;i++)for(let k=i+1;k<m.bodies.length;k++){
  const a=m.bodies[i],b=m.bodies[k];if(root(a.id)!==root(b.id)&&a.collision.shapes.length&&b.collision.shapes.length&&(a.collision.membership&b.collision.filter)&&(b.collision.membership&a.collision.filter))edge(a.id,b.id,'potential-contact');
 }
 const visited=new Set(),components=[];
 for(const b of m.bodies)if(!visited.has(b.id)){const queue=[b.id];visited.add(b.id);for(let i=0;i<queue.length;i++)for(const n of adj.get(queue[i]))if(!visited.has(n)){visited.add(n);queue.push(n);}components.push(queue.sort());}
 return {edges,components,contactEdges:'spanning connections; all potential pairs are determined by collision masks',parents:Object.fromEntries(m.bodies.map(b=>[b.id,m.joints.filter(j=>j.child===b.id).map(j=>j.parent)])),owners:Object.fromEntries(m.bodies.flatMap(b=>b.parts.map(p=>[p,b.id]))),motors:Object.fromEntries((m.motors??[]).map(x=>[x.id,byJoint.get(x.joint).child]))};
}
