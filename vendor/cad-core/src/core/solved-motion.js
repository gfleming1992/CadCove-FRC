// Display sampled solver poses without re-solving or touching cached geometry.
// Hold exact solved samples: interpolating independent body poses can violate loops.
import {identityTransform} from './mechanism.js';
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mul=(a,b)=>Array.from({length:16},(_,i)=>{const r=i%4,c=Math.floor(i/4);let v=0;for(let k=0;k<4;k++)v+=a[k*4+r]*b[c*4+k];return v;});
const inverse=m=>{const a=I.map((v,i)=>i%4<3&&i<12?m[(i%4)*4+Math.floor(i/4)]:v);for(let r=0;r<3;r++)a[12+r]=-a[r]*m[12]-a[4+r]*m[13]-a[8+r]*m[14];return a;};
function rigid(m){
 if(!Array.isArray(m)||m.length!==16||!m.every(Number.isFinite))throw Error('Invalid solved transform');
 const p=mul(inverse(m),m),det=m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]);
 if([3,7,11,15].some(i=>Math.abs(m[i]-I[i])>1e-7)||p.some((v,i)=>Math.abs(v-I[i])>1e-6)||Math.abs(det-1)>1e-6)throw Error('Solver pose must be rigid');
}
export function compileSolvedMotion(value,partIds,revision,model){
 if(!revision||value?.sourceRevision!==revision)throw Error('Solved motion is stale or missing its CAD source revision');
 if(value.schema!==1||value.units!=='mm-deg-s'||!Array.isArray(value.bodies)||!Array.isArray(value.frames)||value.frames.length<1||value.frames.length>10001||value.bodies.length>512)throw Error('Invalid solved motion');
 const plan=structuredClone(value),ids=new Set(partIds),used=new Set(),bodyIds=new Set();
 for(const b of plan.bodies){
  if(typeof b.id!=='string'||bodyIds.has(b.id)||!Array.isArray(b.parts)||!b.parts.length)throw Error('Solved bodies require unique IDs and occurrence bindings');bodyIds.add(b.id);rigid(b.pose);rigid(b.bindPose??b.pose);b.inverseBind=inverse(b.bindPose??b.pose);
  for(const id of b.parts){if(!ids.has(id)||used.has(id))throw Error('Unknown or multiply owned solved part: '+id);used.add(id);}
 }
 const bindings=plan.jointBindings??[],bound=new Set();
 if(!Array.isArray(bindings)||bindings.length>128)throw Error('Invalid solved joint bindings');
 for(const binding of bindings){
  const joint=model?.joints.find(j=>j.id===binding.joint),mate=plan.mates?.find(m=>m.id===binding.mate);
  if(!joint||bound.has(binding.joint)||mate?.type!=='revolute'||![1,-1].includes(binding.scale??1)||!Number.isFinite(binding.offsetDeg??0))throw Error('Invalid solved pulley binding');
  // A coordinate must belong to the actual carrier/pulley occurrences, not an
  // unrelated joint with a conveniently matching name.
  for(const [bodyId,end] of [[joint.parent,mate.a],[joint.child,mate.b]]){
   const parts=model.bodies.find(b=>b.id===bodyId).parts,solved=plan.bodies.find(b=>b.id===end?.body);
   if(!solved||!parts.every(id=>solved.parts.includes(id)))throw Error('Solved pulley binding has mismatched body ownership');
  }
  bound.add(binding.joint);
 }
 const beltAngles=Object.fromEntries((model?.joints??[]).map(j=>[j.id,j.bindAngleDeg]));
 for(const belt of model?.beltSurfaces??[]){
  const driver=model.relations.find(r=>r.id===belt.relation).driver,joint=model.joints.find(j=>j.id===driver);
  const active=used.has(belt.part)||model.bodies.find(b=>b.id===joint.child).parts.some(id=>used.has(id));
  if(active&&!bound.has(driver))throw Error('Solved belt requires a continuous pulley binding: '+driver);
 }
 let last=-1;
 for(const f of plan.frames){
  if(!Number.isFinite(f.time)||f.time<=last||f.time>300||!Array.isArray(f.poses)||f.poses.length!==plan.bodies.length)throw Error('Invalid solved sample timeline');last=f.time;f.poses.forEach(rigid);
  if(bindings.some(b=>!Number.isFinite(f.angles?.[b.joint])))throw Error('Missing continuous solved pulley angle');
  f.angles={...beltAngles,...Object.fromEntries(bindings.map(b=>[b.joint,f.angles[b.joint]]))};
 }
 if(plan.frames[0].time!==0)throw Error('Solved timeline must start at zero');
 return {...plan,kind:'solved',duration:last,partIds};
}
export function evaluateSolvedMotion(plan,time){
 let low=0,high=plan.frames.length;
 // Native integration can emit 0.5000000000000002 for a requested 0.5s.
 while(low+1<high){const mid=(low+high)>>1;if(plan.frames[mid].time<=time+1e-9)low=mid;else high=mid;}
 const sample=plan.frames[low],transforms=Object.fromEntries(plan.partIds.map(id=>[id,identityTransform()]));
 for(let i=0;i<plan.bodies.length;i++){
  const body=plan.bodies[i],delta=mul(sample.poses[i],body.inverseBind);
  const rows=[0,4,8,12,1,5,9,13,2,6,10,14].map(i=>delta[i]);
  for(const id of body.parts)transforms[id]=rows;
 }
 return {transforms,solved:true,sampleTime:sample.time,angles:sample.angles};
}
