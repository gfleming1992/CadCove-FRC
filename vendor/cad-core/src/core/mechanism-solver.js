// Translate reviewed rotary trees into Ondsel constraints. No mesh/STEP rebuild.
import {validateMechanism,resolveJoint,mechanismPose} from './mechanism.js';
const finite = x => typeof x==='number' && Number.isFinite(x);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function frame(origin,axis){
 const seed=Math.abs(axis[0])<.8?[1,0,0]:[0,1,0];
 const v=cross(seed,axis),n=Math.hypot(...v),x=v.map(t=>t/n),y=cross(axis,x);
 return [...x,0,...y,0,...axis,0,...origin,1];
}
const polynomial=(d,t)=>d.position+d.velocity*t+d.acceleration*t*t/2+d.jerk*t*t*t/6;
const mul=(a,b)=>Array.from({length:16},(_,i)=>{const r=i%4,c=Math.floor(i/4);return [0,1,2,3].reduce((v,k)=>v+a[k*4+r]*b[c*4+k],0);});
const inverse=m=>{const r=[m[0],m[4],m[8],0,m[1],m[5],m[9],0,m[2],m[6],m[10],0,0,0,0,1];for(let i=0;i<3;i++)r[12+i]=-[0,1,2].reduce((s,k)=>s+r[4*k+i]*m[12+k],0);return r;};
const fromRows=r=>[r[0],r[4],r[8],0,r[1],r[5],r[9],0,r[2],r[6],r[10],0,r[3],r[7],r[11],1];
function extrema(d,duration){
 const times=[0,duration],a=d.jerk/2,b=d.acceleration,c=d.velocity;
 if(a===0){if(b!==0)times.push(-c/b);}else{const disc=b*b-4*a*c;if(disc>=0)times.push((-b+Math.sqrt(disc))/(2*a),(-b-Math.sqrt(disc))/(2*a));}
 return times.filter(t=>t>=0&&t<=duration).map(t=>polynomial(d,t));
}
export function mechanismSolverRequest(mechanism,motion,sourceRevision){
 const m=validateMechanism(mechanism);
 if(typeof sourceRevision!=='string'||!sourceRevision)throw Error('Current sourceRevision is required');
 if(!motion||Object.keys(motion).some(k=>!['duration','samplePeriod','drives'].includes(k))||!finite(motion.duration)||motion.duration<0||motion.duration>300||!finite(motion.samplePeriod)||motion.samplePeriod<=0||motion.samplePeriod>1||!Array.isArray(motion.drives))throw Error('Expected duration, samplePeriod and polynomial drives');
 const bodies=new Map(m.bodies.map(b=>[b.id,b])),joints=new Map(m.joints.map(j=>[j.id,j])),incoming=new Map(m.relations.map(r=>[r.follower,r]));
 const supplied=new Map();
 for(const d of motion.drives){
  if(!d||Object.keys(d).some(k=>!['joint','position','velocity','acceleration','jerk'].includes(k)))throw Error('Unsupported motion drive fields');
  let id=resolveJoint(m,d.joint);
  let p={position:d.position??joints.get(id).bindAngleDeg,velocity:d.velocity??0,acceleration:d.acceleration??0,jerk:d.jerk??0};
  if(!Object.values(p).every(finite))throw Error('Drive values must be finite');
  while(incoming.has(id)){const r=incoming.get(id);p={position:(p.position-r.phaseDeg)/r.ratio,velocity:p.velocity/r.ratio,acceleration:p.acceleration/r.ratio,jerk:p.jerk/r.ratio};id=r.driver;}
  if(supplied.has(id))throw Error('Conflicting commands to coupled joints: '+id);
  supplied.set(id,p);
 }
 const coords=new Map();
 function coordinate(id){
  if(coords.has(id))return coords.get(id);
  const r=incoming.get(id);let d;
  if(r){const p=coordinate(r.driver);d={position:p.position*r.ratio+r.phaseDeg,velocity:p.velocity*r.ratio,acceleration:p.acceleration*r.ratio,jerk:p.jerk*r.ratio};}
  else d=supplied.get(id)??{position:joints.get(id).bindAngleDeg,velocity:0,acceleration:0,jerk:0};
  coords.set(id,d);return d;
 }
 for(const j of m.joints){const d=coordinate(j.id);if(j.limitsDeg&&extrema(d,motion.duration).some(x=>x<j.limitsDeg[0]-1e-7||x>j.limitsDeg[1]+1e-7))throw Error('Joint limit exceeded during trajectory: '+j.id);}
 for(const r of m.relations){const a=joints.get(r.driver),b=joints.get(r.follower);if(a.parent!==b.parent||Math.max(...a.axis.map((x,i)=>Math.abs(x-b.axis[i])))>1e-7)throw Error('Ondsel coupling requires equally oriented parallel shafts on one carrier: '+r.id);}
 const startAngles=Object.fromEntries(m.joints.map(j=>[j.id,coordinate(j.id).position]));
 if(!m.joints.length)throw Error('Mechanism has no movable joints');
 // Seed the solver from the requested initial placement only. All subsequent
 // poses are solved by Ondsel. Preserve the CAD bind separately for rendering.
 const initial=mechanismPose(m,m.joints[0].id,startAngles[m.joints[0].id],startAngles);
 const deltas=new Map(m.bodies.map(b=>[b.id,fromRows(initial.transforms[b.parts[0]])]));
 const bind=new Map(m.bodies.map(b=>[b.id,[1,0,0,0,0,1,0,0,0,0,1,0,...b.origin,1]]));
 const poses=new Map(m.bodies.map(b=>[b.id,mul(deltas.get(b.id),bind.get(b.id))]));
 return {schema:1,units:'mm-deg-s',sourceRevision,duration:motion.duration,samplePeriod:motion.samplePeriod,
  bodies:m.bodies.map(b=>({id:b.id,pose:poses.get(b.id),bindPose:bind.get(b.id),fixed:b.fixed,parts:b.parts})),
  mates:m.joints.map(j=>{const world=mul(deltas.get(j.parent),frame(j.origin,j.axis));return {id:j.id,type:'revolute',a:{body:j.parent,frame:mul(inverse(poses.get(j.parent)),world)},b:{body:j.child,frame:mul(inverse(poses.get(j.child)),world)}};}),
  drives:m.joints.filter(j=>!incoming.has(j.id)).map(j=>({joint:j.id,...coordinate(j.id),position:0})),
  couplings:m.relations.map(r=>Object.fromEntries(['id','type','driver','follower','driverTeeth','followerTeeth','direction'].map(k=>[k,r[k]]))),
  jointBindings:m.joints.map(j=>({joint:j.id,mate:j.id,offsetDeg:startAngles[j.id]}))};
}
