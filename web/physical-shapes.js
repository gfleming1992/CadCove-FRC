import {compose,translation,rotation} from '../lib/transforms.js';
// Explicit collision proxies for physical-only game elements. CAD-bound bodies
// continue using their source geometry; these previews never infer colliders.
export function physicalVisuals(model){
 const prototypes=[],instances=[],bindings=[];
 for(const b of model.bodies)if(!b.parts.length)for(const [index,s]of b.collision.shapes.entries()){
  if(!['box','ball','cylinder'].includes(s.kind))throw Error('Physical-only '+s.kind+' body '+b.id+' requires explicit CAD visual geometry; collision mesh preview is unsupported');
  const id=`physics/${b.id}/${index}`,positions=[],normals=[],indices=[];
  const triangle=(a,c,d)=>{const base=positions.length/3,u=c.map((x,i)=>x-a[i]),v=d.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n)||1;for(const p of [a,c,d]){positions.push(...p.map(x=>x*1000));normals.push(...n.map(x=>x/length));}indices.push(base,base+1,base+2);};
  if(s.kind==='box'){
   const v=Array.from({length:8},(_,i)=>s.half.map((h,k)=>((i>>k)&1)?h:-h));
   for(const [a,c,d,e]of [[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]]){triangle(v[a],v[c],v[d]);triangle(v[a],v[d],v[e]);}
  }else if(s.kind==='ball'){
   const pt=(i,j)=>{const theta=i*Math.PI/12,phi=j*Math.PI/12;return [s.radius*Math.sin(theta)*Math.cos(phi),s.radius*Math.sin(theta)*Math.sin(phi),s.radius*Math.cos(theta)];};
   for(let i=0;i<12;i++)for(let j=0;j<24;j++){triangle(pt(i,j),pt(i+1,j),pt(i+1,j+1));triangle(pt(i,j),pt(i+1,j+1),pt(i,j+1));}
  }else if(s.kind==='cylinder'){
   const pt=(j,y)=>[s.radius*Math.cos(j*Math.PI/12),y,s.radius*Math.sin(j*Math.PI/12)];
   for(let j=0;j<24;j++){const a=pt(j,-s.halfHeight),c=pt(j,s.halfHeight),d=pt(j+1,s.halfHeight),e=pt(j+1,-s.halfHeight);triangle(a,c,d);triangle(a,d,e);triangle([0,s.halfHeight,0],d,c);triangle([0,-s.halfHeight,0],a,e);}
  }
  const rv=s.rotation??[0,0,0],angle=Math.hypot(...rv),local=compose(translation(s.center),rotation(angle?rv.map(v=>v/angle):[0,0,1],angle));
  const ba=Math.hypot(...b.rotation),bind=compose(translation(b.position),rotation(ba?b.rotation.map(x=>x/ba):[0,0,1],ba)),transform=compose(bind,local).map((v,i)=>i%4===3?v*1000:v);
  prototypes.push({id,name:b.id+' collision preview',color:'#e9bd48',positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices)});
  instances.push({id,asset:id,color:'#e9bd48',transform});bindings.push({id,body:b.id,local});
 }
 return {prototypes,instances,bindings};
}
