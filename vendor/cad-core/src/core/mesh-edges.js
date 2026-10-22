// Display edges only: keep open boundaries and sharp normal discontinuities,
// never triangle diagonals or smooth tessellation seams. Indices reference the
// original vertices so rigid motion and belt deformation reuse the same buffer.
const cache = new WeakMap();
export function meshEdges(part) {
 const old=cache.get(part.positions);
 if(old?.normals===part.normals&&old.indices===part.indices)return old.edges;
 const {positions:p,normals:n,indices:ix}=part,vertices=new Map(),weld=new Uint32Array(p.length/3);
 // Float32 precision is already the limiting accuracy. Quantize only for
 // matching duplicate vertices along OCCT face seams; never move geometry.
 let scale=1;for(const x of p)scale=Math.max(scale,Math.abs(x));
 const epsilon=scale*1e-7;
 for(let i=0;i<weld.length;i++){
  const key=[0,1,2].map(k=>Math.round(p[i*3+k]/epsilon)).join(',');
  if(!vertices.has(key))vertices.set(key,vertices.size);weld[i]=vertices.get(key);
 }
 const links=new Map(),cosine=Math.cos(Math.PI/6);
 const smooth=(a,b)=>{
  let dot=0,aa=0,bb=0;for(let k=0;k<3;k++){dot+=n[a*3+k]*n[b*3+k];aa+=n[a*3+k]**2;bb+=n[b*3+k]**2;}
  return aa>0&&bb>0&&dot/Math.sqrt(aa*bb)>cosine;
 };
 for(let t=0;t<ix.length;t+=3)for(let k=0;k<3;k++){
  let a=ix[t+k],b=ix[t+(k+1)%3];if(weld[a]===weld[b])continue;
  if(weld[a]>weld[b])[a,b]=[b,a];const key=weld[a]+','+weld[b],old=links.get(key);
  if(old){old.count++;old.sharp ||= !smooth(a,old.a)||!smooth(b,old.b);}
  else links.set(key,{a,b,count:1,sharp:false});
 }
 const result=[];for(const {a,b,count,sharp} of links.values())if(count===1||sharp)result.push(a,b);
 const edges=new Uint32Array(result);cache.set(p,{normals:n,indices:ix,edges});return edges;
}
