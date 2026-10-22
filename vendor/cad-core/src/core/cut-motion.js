// Deterministic 2.5D stock-removal preview. Cell-centre sampling is explicit;
// no CAD source mutation, toolpath planning, part release or physics occurs here.
import {identityTransform} from './mechanism.js';
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e6);
export function validateCutRequest(value){
 const p=structuredClone(value),s=p?.stock,t=p?.tool;
 if(p?.schema!==1||p.units!=='mm-s'||!s||!vec(s.origin)||!vec(s.size)||s.size.some(x=>x<=0)||typeof s.id!=='string'||!s.id||!t||!['router','laser'].includes(t.kind)||typeof t.id!=='string'||!t.id||t.id===s.id||!Number.isFinite(t.diameterMm)||t.diameterMm<=0||!Number.isFinite(t.lengthMm)||t.lengthMm<=0||!vec(p.start))throw Error('Expected mm-s rectangular stock, tool and start point');
 if(!Number.isFinite(p.resolutionMm)||p.resolutionMm<=0||p.resolutionMm>t.diameterMm/3)throw Error('Stock resolution must be positive and at most one third of cutter diameter or kerf');
 if(![s.id,t.id].every(id=>/^[a-zA-Z0-9_.:/-]{1,200}$/.test(id))||t.diameterMm>10000||t.lengthMm>10000)throw Error('Invalid stock/tool identifier or dimensions');
 const nx=Math.ceil(s.size[0]/p.resolutionMm),ny=Math.ceil(s.size[1]/p.resolutionMm);
 if(nx*ny>40000)throw Error('Cut preview exceeds 40000 stock cells; reduce stock area or use a coarser resolution within the kerf limit');
 if(!Array.isArray(p.moves)||!p.moves.length||p.moves.length>2000)throw Error('Provide 1–2000 explicit linear tool moves');
 let time=0,from=p.start;
 p.moves=p.moves.map(m=>{
  if(!['cut','rapid'].includes(m.mode)||!vec(m.to)||!Number.isFinite(m.seconds)||m.seconds<=0)throw Error('Each move needs cut/rapid mode, XYZ to, and positive seconds');
  if(t.kind==='laser'&&m.mode==='cut'&&(Math.abs(from[2]-m.to[2])>1e-8||m.to[2]>s.origin[2]))throw Error('Laser cut moves must be through the stock at a constant Z at or below its bottom');
  const out={...m,from:[...from],start:time};time+=m.seconds;from=m.to;return out;
 });
 const hold=p.holdSeconds??0;if(!Number.isFinite(hold)||hold<0||time+hold>300)throw Error('Cut preview duration must be at most 300 seconds');
 return {...p,kind:'cut',duration:time+hold,nx,ny,dx:s.size[0]/nx,dy:s.size[1]/ny};
}
export function compileCutMotion(value,scene,revision){
 if(!revision||value?.sourceRevision!==revision)throw Error('Cut preview is stale or missing its CAD source revision');
 const p=validateCutRequest(value),stock=scene.parts.find(v=>v.id===p.stock.id),tool=scene.parts.find(v=>v.id===p.tool.id);
 if(!stock||!tool)throw Error('Cut stock or tool is missing from this scene');
 // Replacement is only permitted for an uncut box, not an arbitrary CAD part.
 const lo=p.stock.origin,hi=lo.map((v,i)=>v+p.stock.size[i]),eps=1e-4;
 let volume=0;
 for(let i=0;i<stock.indices.length;i+=3){
  const a=[0,1,2].map(k=>Array.from(stock.positions.slice(stock.indices[i+k]*3,stock.indices[i+k]*3+3)));
  if(![0,1,2].some(k=>[lo[k],hi[k]].some(v=>a.every(pt=>Math.abs(pt[k]-v)<eps)))||a.some(pt=>pt.some((v,k)=>v<lo[k]-eps||v>hi[k]+eps)))throw Error('Cut preview stock must match the declared uncut rectangular box');
  const [u,v,w]=a;volume+=(u[0]*(v[1]*w[2]-v[2]*w[1])+u[1]*(v[2]*w[0]-v[0]*w[2])+u[2]*(v[0]*w[1]-v[1]*w[0]))/6;
 }
 const expected=p.stock.size.reduce((a,b)=>a*b,1);
 if(Math.abs(Math.abs(volume)-expected)>expected*1e-4)throw Error('Cut stock mesh volume does not match the declared box');
 return {...p,partIds:scene.parts.map(v=>v.id)};
}
// Deepest flat-ended cylindrical tool position that reaches this cell centre.
// Intersect the XY segment with a disk; Z varies linearly through this interval.
function toolDepth(x,y,a,b,r){
 const vx=b[0]-a[0],vy=b[1]-a[1],dx=a[0]-x,dy=a[1]-y,A=vx*vx+vy*vy;
 if(A<1e-20)return dx*dx+dy*dy<=r*r?Math.min(a[2],b[2]):Infinity;
 const B=2*(dx*vx+dy*vy),C=dx*dx+dy*dy-r*r,D=B*B-4*A*C;
 if(D<0)return Infinity;
 const low=Math.max(0,(-B-Math.sqrt(D))/(2*A)),high=Math.min(1,(-B+Math.sqrt(D))/(2*A));
 if(low>high)return Infinity;
 return a[2]+(b[2]-a[2])*(b[2]>=a[2]?low:high);
}
export class CutSurfaces {
 constructor(plan,scene){
  this.plan=plan;this.source=scene.parts.find(p=>p.id===plan.stock.id);
  const count=plan.nx*plan.ny;this.heights=new Float64Array(count);
  this.positions=new Float32Array(count*24*3);this.normals=new Float32Array(this.positions.length);const indices=new Uint32Array(count*36);
  for(let i=0;i<count*6;i++){const v=i*4;indices.set([v,v+1,v+2,v,v+2,v+3],i*6);}
  this.mesh={...this.source,positions:this.positions,normals:this.normals,indices};this.last=-1;
  this.evaluate(plan,0);
 }
 renderParts(){return {[this.source.id]:this.mesh};}
 originals(){return {[this.source.id]:this.source};}
 carve(a,b){
  const p=this.plan,r=p.tool.diameterMm/2,[ox,oy,oz]=p.stock.origin;
  const xmin=Math.max(0,Math.floor((Math.min(a[0],b[0])-r-ox)/p.dx)),xmax=Math.min(p.nx-1,Math.floor((Math.max(a[0],b[0])+r-ox)/p.dx));
  const ymin=Math.max(0,Math.floor((Math.min(a[1],b[1])-r-oy)/p.dy)),ymax=Math.min(p.ny-1,Math.floor((Math.max(a[1],b[1])+r-oy)/p.dy));
  for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++){
   const z=Math.max(oz,toolDepth(ox+(x+.5)*p.dx,oy+(y+.5)*p.dy,a,b,r)),i=y*p.nx+x;
   if(z<this.heights[i]){this.heights[i]=z;this.changed=true;}
  }
 }
 rebuild(){
  const p=this.plan,[ox,oy,z0]=p.stock.origin;
  const quad=(slot,pts,n)=>{for(let k=0;k<4;k++){this.positions.set(pts[k],slot+k*3);this.normals.set(n,slot+k*3);}};
  for(let y=0;y<p.ny;y++)for(let x=0;x<p.nx;x++){
   const i=y*p.nx+x,s=i*72,z=this.heights[i],x0=ox+x*p.dx,x1=x0+p.dx,y0=oy+y*p.dy,y1=y0+p.dy;
   const top=[[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]];
   // Fully removed cells collapse to a point, leaving no bottom across a kerf.
   if(z<=z0+1e-10){for(let k=0;k<24;k++)this.positions.set([x0,y0,z0],s+k*3);continue;}
   quad(s,top,[0,0,1]);quad(s+12,[[x0,y1,z0],[x1,y1,z0],[x1,y0,z0],[x0,y0,z0]],[0,0,-1]);
   const levels=[y?this.heights[i-p.nx]:z0,x<p.nx-1?this.heights[i+1]:z0,y<p.ny-1?this.heights[i+p.nx]:z0,x?this.heights[i-1]:z0];
   for(let k=0;k<4;k++){const a=top[k],b=top[(k+1)%4],bottom=Math.min(z,levels[k]);quad(s+24+k*12,[a,[a[0],a[1],bottom],[b[0],b[1],bottom],b],[[0,-1,0],[1,0,0],[0,1,0],[-1,0,0]][k]);}
  }
 }
 evaluate(plan,time){
  const t=Math.max(0,Math.min(plan.duration,time));this.changed=false;
  if(this.last<0||t<this.last){this.heights.fill(plan.stock.origin[2]+plan.stock.size[2]);this.last=0;this.changed=true;}
  let tip=plan.start;
  for(const m of plan.moves){
   if(t<m.start)break;
   const f=Math.min(1,(t-m.start)/m.seconds);tip=m.from.map((v,k)=>v+(m.to[k]-v)*f);
   if(m.mode==='cut'&&t>m.start&&this.last<m.start+m.seconds){const start=Math.max(0,(this.last-m.start)/m.seconds),a=m.from.map((v,k)=>v+(m.to[k]-v)*start);this.carve(a,tip);}
  }
  if(this.changed)this.rebuild();this.last=t;
  const transforms=Object.fromEntries(plan.partIds?.map(id=>[id,identityTransform()])??[]),tool=identityTransform();[tool[3],tool[7],tool[11]]=tip;transforms[plan.tool.id]=tool;
  return {angles:{},transforms,...(this.changed?{deformations:{[plan.stock.id]:{positions:this.positions,normals:this.normals}}}:{})};
 }
}
