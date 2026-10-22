// Presentation-only, constant neutral-axis length sheet bending. The external
// unfolder supplies real wall/bend zones; this module never infers tooling.
import {identityTransform} from './mechanism.js';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const vec=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
const local=(p,b)=>b.axes.map(a=>dot(p.map((v,i)=>v-b.origin[i]),a));
const world=(p,b)=>b.origin.map((v,k)=>v+p.reduce((s,x,i)=>s+x*b.axes[i][k],0));
const dir=(p,b)=>[0,1,2].map(k=>p.reduce((s,x,i)=>s+x*b.axes[i][k],0));

// Same map for curved material and downstream rigid material. Nested maps run
// from the leaf back to the root, so the child's bend frame follows its parent.
export function bendPoint(point,normal,bend,fraction,curved){
 const theta=bend.angleDeg*Math.PI/180*fraction;
 if(Math.abs(theta)<1e-10)return {point:[...point],normal:[...normal]};
 const p=local(point,bend),n=bend.axes.map(a=>dot(normal,a)),length=bend.lengthMm;
 const s=curved?Math.max(0,Math.min(length,p[1])):length;
 const angle=theta*s/length,r=length/theta,z=p[2]-bend.neutralOffsetMm,tail=curved?0:p[1]-length;
 const c=Math.cos(angle),sn=Math.sin(angle),scale=curved?1-z/r:1;
 if(scale<=0)throw Error('Fold has inverted material');
 const mapped=[p[0],(r-z)*sn+tail*c,bend.neutralOffsetMm+2*r*Math.sin(angle/2)**2+z*c+tail*sn];
 const nn=[n[0],n[1]/scale*c-n[2]*sn,n[1]/scale*sn+n[2]*c],size=Math.hypot(...nn);
 return {point:world(mapped,bend),normal:dir(nn.map(v=>v/size),bend)};
}

export function compileFoldMotion(value,scene,revision){
 if(!revision||value?.sourceRevision!==revision)throw Error('Fold motion is stale or missing its CAD source revision');
 const plan=structuredClone(value),d=plan.definition;
 if(plan.schema!==1||d?.schema!==1||d.units!=='mm-deg-s'||!Number.isFinite(d.thicknessMm)||d.thicknessMm<=0||!Array.isArray(d.bends)||!d.bends.length||d.bends.length>64||!Array.isArray(d.zones)||d.zones.length>128)throw Error('Invalid fold definition');
 const bends=new Map(),parts=new Set(),ids=new Set(scene.parts.map(p=>p.id));
 for(const b of d.bends){
  if(typeof b.id!=='string'||!b.id||bends.has(b.id)||!vec(b.origin)||!Array.isArray(b.axes)||b.axes.length!==3||!b.axes.every(vec)||!Number.isFinite(b.angleDeg)||Math.abs(b.angleDeg)<1e-6||Math.abs(b.angleDeg)>180.000001||!Number.isFinite(b.lengthMm)||b.lengthMm<=0||!Number.isFinite(b.neutralOffsetMm)||b.neutralOffsetMm>1e-6||b.neutralOffsetMm< -d.thicknessMm-1e-6)throw Error('Invalid fold bend');
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(Math.abs(dot(b.axes[i],b.axes[j])-(i===j?1:0))>1e-6)throw Error('Fold frame must be orthonormal');
  const [x,y,z]=b.axes;if(dot([x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]],z)<.999999)throw Error('Fold frame must be right-handed');
  const r=b.lengthMm/(b.angleDeg*Math.PI/180);
  if([0,-d.thicknessMm].some(z=>1-(z-b.neutralOffsetMm)/r<=0))throw Error('Fold has nonpositive inner radius');
  bends.set(b.id,b);
 }
 const owners=new Map();
 for(const z of d.zones){
  if(!ids.has(z.id)||parts.has(z.id)||!Array.isArray(z.chain)||z.chain.length>64||new Set(z.chain).size!==z.chain.length||z.chain.some(id=>!bends.has(id))||z.bend!=null&&(z.chain.at(-1)!==z.bend||owners.has(z.bend)))throw Error('Invalid fold zone ownership');
  parts.add(z.id);if(z.bend!=null)owners.set(z.bend,z);
 }
 for(const b of bends.keys())if(!owners.has(b))throw Error('Missing bend region');
 for(const z of d.zones)for(let i=0;i<z.chain.length;i++)if(JSON.stringify(owners.get(z.chain[i]).chain)!==JSON.stringify(z.chain.slice(0,i+1)))throw Error('Inconsistent fold parent chain');
 if(!Array.isArray(plan.tracks)||plan.tracks.length!==bends.size)throw Error('Provide one fold track per bend');
 let duration=0;const targets=new Set();
 for(const t of plan.tracks){
  if(!bends.has(t.bend)||targets.has(t.bend)||!Number.isFinite(t.startSeconds)||t.startSeconds<0||!Number.isFinite(t.seconds)||t.seconds<=0)throw Error('Invalid fold track timing');
  targets.add(t.bend);duration=Math.max(duration,t.startSeconds+t.seconds);
 }
 const hold=plan.holdSeconds??0;if(!Number.isFinite(hold)||hold<0||duration+hold>300)throw Error('Fold timeline must be at most 300 seconds');
 return {...plan,kind:'fold',duration:duration+hold,bends,partIds:[...ids]};
}

export class FoldSurfaces {
 constructor(plan,scene){
  let count=0;
  this.zones=plan.definition.zones.map(z=>{
   const source=scene.parts.find(p=>p.id===z.id),positions=Array.from(source.positions),normals=Array.from(source.normals),indices=[];
   count+=positions.length/3;if(count>500000)throw Error('Fold vertex budget exceeded');
   const bend=plan.bends.get(z.bend),pending=[],midpoints=new Map();
   // Refine just the bend strip once, not the whole scene or CAD cache.
   if(bend){
    const u=[];for(let i=0;i<positions.length;i+=3)u.push(local(positions.slice(i,i+3),bend)[1]);
    if(u.some(v=>v< -1e-4||v>bend.lengthMm+1e-4))throw Error('Bend mesh lies outside its material strip');
    for(let i=0;i<source.indices.length;i+=3)pending.push(Array.from(source.indices.slice(i,i+3)));
    while(pending.length){
     const tri=pending.pop();let edge=-1,longest=bend.lengthMm/48;
     for(let k=0;k<3;k++){const dist=Math.abs(u[tri[k]]-u[tri[(k+1)%3]]);if(dist>longest){longest=dist;edge=k;}}
     if(edge<0){indices.push(...tri);continue;}
     const a=tri[edge],b=tri[(edge+1)%3],c=tri[(edge+2)%3],key=a<b?a+':'+b:b+':'+a;let mid=midpoints.get(key);
     if(mid===undefined){
      if(++count>500000)throw Error('Refined fold vertex budget exceeded');mid=positions.length/3;
      for(let k=0;k<3;k++){positions.push((positions[a*3+k]+positions[b*3+k])/2);normals.push((normals[a*3+k]+normals[b*3+k])/2);}
      u.push((u[a]+u[b])/2);midpoints.set(key,mid);
     }
     pending.push([a,mid,c],[mid,b,c]);
    }
   }else indices.push(...source.indices);
   const mesh={...source,positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices)};
   return {...z,source,mesh,positions:new Float32Array(positions.length),normals:new Float32Array(normals.length),chain:z.chain.map(id=>plan.bends.get(id)).reverse()};
  });
 }
 renderParts(){return Object.fromEntries(this.zones.map(z=>[z.id,z.mesh]));}
 originals(){return Object.fromEntries(this.zones.map(z=>[z.id,z.source]));}
 evaluate(plan,seconds){
  const fractions=Object.fromEntries(plan.tracks.map(t=>[t.bend,Math.max(0,Math.min(1,(seconds-t.startSeconds)/t.seconds))]));
  const changes={};
  for(const z of this.zones){
   for(let i=0;i<z.positions.length;i+=3){
    let p=Array.from(z.mesh.positions.slice(i,i+3)),n=Array.from(z.mesh.normals.slice(i,i+3));
    for(const b of z.chain){const next=bendPoint(p,n,b,fractions[b.id],z.bend===b.id);p=next.point;n=next.normal;}
    z.positions.set(p,i);z.normals.set(n,i);
   }
   changes[z.id]={positions:z.positions,normals:z.normals};
  }
  return {angles:{},transforms:Object.fromEntries(plan.partIds.map(id=>[id,identityTransform()])),deformations:changes};
 }
}
