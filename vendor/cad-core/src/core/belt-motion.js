// Deform the existing tessellation around a declared pitch path. Source CAD,
// topology, ownership, and cache remain unchanged. No belt-contact physics.
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,n)=>a.map(v=>v*n);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const mod=(x,n)=>((x%n)+n)%n,TAU=2*Math.PI;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function frame(segment,t,axis){
 if(segment.kind==='line')return {point:add(segment.from,mul(segment.tangent,t)),tangent:segment.tangent,normal:cross(segment.tangent,axis),width:axis};
 const angle=segment.angle-t/segment.radius,n=add(mul(segment.e,Math.cos(angle)),mul(segment.v,Math.sin(angle))),tangent=mul(cross(axis,n),-1);
 return {point:add(segment.center,mul(n,segment.radius)),tangent,normal:cross(tangent,axis),width:axis};
}
export function openBeltPath(pulleys,axis){
 if(!Array.isArray(pulleys)||pulleys.length!==2||pulleys.some(p=>!vec(p.centerMm)||!Number.isFinite(p.pitchRadiusMm)||p.pitchRadiusMm<=0)||!vec(axis)||Math.abs(Math.hypot(...axis)-1)>1e-6)throw Error('Belt requires two pulley centers/radii and a unit width axis');
 const [a,b]=pulleys,r0=a.pitchRadiusMm,r1=b.pitchRadiusMm,d=sub(b.centerMm,a.centerMm),distance=Math.hypot(...d);
 if(distance<=r0+r1||Math.abs(dot(d,axis))>1e-4)throw Error('Belt pulleys must be separated and coplanar');
 const e=mul(d,1/distance),v=cross(axis,e),alpha=Math.acos((r0-r1)/distance),normal=t=>add(mul(e,Math.cos(t)),mul(v,Math.sin(t)));
 const p0=add(a.centerMm,mul(normal(alpha),r0)),p1=add(b.centerMm,mul(normal(alpha),r1)),p2=add(b.centerMm,mul(normal(-alpha),r1)),p3=add(a.centerMm,mul(normal(-alpha),r0));
 const line=(from,to)=>{const d=sub(to,from),length=Math.hypot(...d);return {kind:'line',from,length,tangent:mul(d,1/length)};};
 const segments=[line(p0,p1),{kind:'arc',center:b.centerMm,radius:r1,angle:alpha,length:2*alpha*r1,e,v},line(p2,p3),{kind:'arc',center:a.centerMm,radius:r0,angle:-alpha,length:(TAU-2*alpha)*r0,e,v}];
 let length=0;for(const s of segments){s.start=length;length+=s.length;}
 return {segments,length,axis};
}
export function sampleBeltPath(path,distance){const s=mod(distance,path.length),segment=path.segments.find(p=>s<p.start+p.length)??path.segments.at(-1);return frame(segment,s-segment.start,path.axis);}
function project(path,p){
 let best;
 for(const s of path.segments){let t;
  if(s.kind==='line')t=clamp(dot(sub(p,s.from),s.tangent),0,s.length);
  else{const d=sub(p,s.center),angle=Math.atan2(dot(d,s.v),dot(d,s.e)),sweep=mod(s.angle-angle,TAU);t=sweep*s.radius;if(t>s.length){const start=frame(s,0,path.axis).point,end=frame(s,s.length,path.axis).point;t=dot(sub(p,start),sub(p,start))<=dot(sub(p,end),sub(p,end))?0:s.length;}}
  const f=frame(s,t,path.axis),d=sub(p,f.point),distance=dot(d,d);
  if(!best||distance<best.distance)best={...f,distance,s:s.start+t,width:dot(d,f.width),offset:dot(d,f.normal)};
 }
 return best;
}
export function compileBeltSurfaces(model){
 const ids=new Set(),parts=new Set();
 if(model.beltSurfaces!==undefined&&!Array.isArray(model.beltSurfaces))throw Error('beltSurfaces must be an array');
 if((model.beltSurfaces?.length??0)>100)throw Error('Too many animated belts');
 return (model.beltSurfaces??[]).map(b=>{
  const body=model.bodies.find(v=>v.id===b.body),r=model.relations.find(v=>v.id===b.relation),j=model.joints.find(v=>v.id===r?.driver),f=model.joints.find(v=>v.id===r?.follower);
  if(typeof b.id!=='string'||!b.id||ids.has(b.id)||parts.has(b.part)||!body?.parts.includes(b.part)||!r||!['belt','chain'].includes(r.type)||j.parent!==body.id||f.parent!==body.id)throw Error('Invalid belt surface ownership/relation');
  if(!Number.isFinite(b.pitchMm)||b.pitchMm<=0||![1,-1].includes(b.direction))throw Error('Belt requires positive pitch and explicit travel direction');
  const path=openBeltPath(b.pulleys,b.widthAxis);
  if(Math.abs(b.pulleys[0].pitchRadiusMm*TAU-r.driverTeeth*b.pitchMm)>1e-3||Math.abs(b.pulleys[1].pitchRadiusMm*TAU-r.followerTeeth*b.pitchMm)>1e-3)throw Error('Belt pitch radii must agree with transmission teeth');
  // Pulley centers may be shifted along their axes to the belt's width plane.
  for(const [i,joint]of [j,f].entries()){const d=sub(b.pulleys[i].centerMm,joint.origin);if(Math.hypot(...sub(d,mul(joint.axis,dot(d,joint.axis))))>.5||Math.abs(Math.abs(dot(joint.axis,b.widthAxis))-1)>1e-5)throw Error('Belt path does not align with its pulley joints');}
  if(b.toothCount!==undefined&&(!Number.isSafeInteger(b.toothCount)||b.toothCount<1||Math.abs(path.length-b.toothCount*b.pitchMm)>.5))throw Error('Belt path length disagrees with tooth count');
  ids.add(b.id);parts.add(b.part);return {...b,path,driver:r.driver,teeth:r.driverTeeth,bind:j.bindAngleDeg};
 });
}
// Allocation-free hot path; the public sampler above is convenient for authoring.
function sampleInto(path,distance,out){
 const s=mod(distance,path.length),segment=path.segments.find(p=>s<p.start+p.length)??path.segments.at(-1),t=s-segment.start,a=path.axis;
 if(segment.kind==='line')for(let k=0;k<3;k++){out[k]=segment.from[k]+segment.tangent[k]*t;out[k+3]=segment.tangent[k];}
 else{
  const angle=segment.angle-t/segment.radius,c=Math.cos(angle),sn=Math.sin(angle),e=segment.e,v=segment.v;
  const x=e[0]*c+v[0]*sn,y=e[1]*c+v[1]*sn,z=e[2]*c+v[2]*sn;
  out[0]=segment.center[0]+x*segment.radius;out[1]=segment.center[1]+y*segment.radius;out[2]=segment.center[2]+z*segment.radius;
  out[3]=a[2]*y-a[1]*z;out[4]=a[0]*z-a[2]*x;out[5]=a[1]*x-a[0]*y;
 }
 out[6]=out[4]*a[2]-out[5]*a[1];out[7]=out[5]*a[0]-out[3]*a[2];out[8]=out[3]*a[1]-out[4]*a[0];
}
export class BeltSurfaces {
 constructor(model,scene){
  let vertices=0;
  this.belts=compileBeltSurfaces(model).map(b=>{
   const mesh=scene.parts.find(p=>p.id===b.part);if(!mesh)throw Error('Missing belt mesh');vertices+=mesh.positions.length/3;if(vertices>500000)throw Error('Animated belt vertex budget exceeded');
   // Long flat-face triangles cannot bend around a pulley. Subdivide only
   // along travel, preserving the imported surface and using no CAD kernel.
   const positions=Array.from(mesh.positions),normals=Array.from(mesh.normals),coordinates=[];
   const coordinate=i=>{const p=positions.slice(i*3,i*3+3),n=normals.slice(i*3,i*3+3),f=project(b.path,p);return {s:f.s,w:f.width,h:f.offset,normal:[dot(n,f.tangent),dot(n,b.widthAxis),dot(n,f.normal)]};};
   for(let i=0;i<positions.length/3;i++)coordinates.push(coordinate(i));
   const indices=[],midpoints=new Map(),pending=[];
   for(let i=0;i<mesh.indices.length;i+=3)pending.push(Array.from(mesh.indices.slice(i,i+3)));
   while(pending.length){
    const tri=pending.pop();let edge=-1,longest=Math.min(b.pitchMm,5);
    for(let k=0;k<3;k++){const d=Math.abs(coordinates[tri[k]].s-coordinates[tri[(k+1)%3]].s),distance=Math.min(d,b.path.length-d);if(distance>longest){longest=distance;edge=k;}}
    if(edge<0){indices.push(...tri);continue;}
    const a=tri[edge],c=tri[(edge+1)%3],d=tri[(edge+2)%3],key=a<c?a+':'+c:c+':'+a;let mid=midpoints.get(key);
    if(mid===undefined){
     mid=coordinates.length;if(++vertices>500000)throw Error('Refined belt vertex budget exceeded');
     for(let k=0;k<3;k++)positions.push((positions[a*3+k]+positions[c*3+k])/2);
     const n=[0,1,2].map(k=>(normals[a*3+k]+normals[c*3+k])/2),size=Math.hypot(...n)||1;normals.push(...n.map(v=>v/size));coordinates.push(coordinate(mid));midpoints.set(key,mid);
    }
    pending.push([a,mid,d],[mid,c,d]);
   }
   const refined={...mesh,positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices)};
   return {...b,source:mesh,mesh:refined,coordinates,positions:new Float32Array(positions.length),normals:new Float32Array(normals.length),lastPhase:null};
  });
 }
 evaluate(angles,{force=false}={}){
  const changes={};
  for(const b of this.belts){
   const angle=angles[b.driver];if(!Number.isFinite(angle))throw Error('Missing belt driver angle');
   const phase=mod((angle-b.bind)*b.teeth*b.pitchMm/360*b.direction,b.path.length);
   if(!force&&phase===b.lastPhase)continue;b.lastPhase=phase;
   if(phase<1e-9||b.path.length-phase<1e-9){b.positions.set(b.mesh.positions);b.normals.set(b.mesh.normals);}
   else{const f=new Float64Array(9);for(let i=0;i<b.coordinates.length;i++){const c=b.coordinates[i];sampleInto(b.path,c.s+phase,f);for(let k=0;k<3;k++){b.positions[i*3+k]=f[k]+c.w*b.widthAxis[k]+c.h*f[k+6];b.normals[i*3+k]=c.normal[0]*f[k+3]+c.normal[1]*b.widthAxis[k]+c.normal[2]*f[k+6];}}}
   changes[b.part]={positions:b.positions,normals:b.normals};
  }
  return changes;
 }
 originals(){return Object.fromEntries(this.belts.map(b=>[b.part,b.source]));}
 renderParts(){return Object.fromEntries(this.belts.map(b=>[b.part,b.mesh]));}
}
