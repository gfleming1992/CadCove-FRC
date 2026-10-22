// Deterministic 2.5D stock-removal preview. Cell-centre sampling is explicit;
// no CAD source mutation, toolpath planning, part release or physics occurs here.
import {identityTransform} from './mechanism.js';
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e6);
export function validateCutRequest(value){
 const p=structuredClone(value),s=p?.stock,t=p?.tool;
 if(p?.schema!==1||p.units!=='mm-s'||!s||!vec(s.origin)||!vec(s.size)||s.size.some(x=>x<=0)||typeof s.id!=='string'||!s.id||!t||!['bit','router','laser'].includes(t.kind)||typeof t.id!=='string'||!t.id||t.id===s.id||!Number.isFinite(t.diameterMm)||t.diameterMm<=0||!Number.isFinite(t.lengthMm)||t.lengthMm<=0||!vec(p.start))throw Error('Expected mm-s rectangular stock, tool and start point');
 if(!Number.isFinite(p.resolutionMm)||p.resolutionMm<=0||p.resolutionMm>t.diameterMm/3*(1+1e-12))throw Error('Stock resolution must be positive and at most one third of cutter diameter or kerf');
 if(t.nozzleId!==undefined&&(t.kind!=='laser'||typeof t.nozzleId!=='string'||[s.id,t.id].includes(t.nozzleId)))throw Error('Laser nozzle must have a distinct part ID');
 if(![s.id,t.id,...(t.nozzleId?[t.nozzleId]:[])].every(id=>/^[a-zA-Z0-9_.:/-]{1,200}$/.test(id))||t.diameterMm>10000||t.lengthMm>10000)throw Error('Invalid stock/tool identifier or dimensions');
 const nx=Math.ceil(s.size[0]/p.resolutionMm),ny=Math.ceil(s.size[1]/p.resolutionMm);
 if(nx*ny>40000)throw Error('Cut preview exceeds 40000 stock cells; reduce stock area or use a coarser resolution within the kerf limit');
 if(!Array.isArray(p.moves)||!p.moves.length||p.moves.length>2000)throw Error('Provide 1–2000 explicit linear tool moves');
 let time=0,from=p.start;
 p.moves=p.moves.map(m=>{
  if(!['cut','rapid'].includes(m.mode)||!vec(m.to)||!Number.isFinite(m.seconds)||m.seconds<=0)throw Error('Each move needs cut/rapid mode, XYZ to, and positive seconds');
  if(t.kind==='laser'&&m.mode==='cut'&&(Math.abs(from[2]-m.to[2])>1e-8||m.to[2]>s.origin[2]))throw Error('Laser cut moves must be through the stock at a constant Z at or below its bottom');
  if(t.kind==='laser'&&m.mode==='cut'&&m.to[2]+t.lengthMm<=s.origin[2]+s.size[2])throw Error('Laser nozzle must be above the stock surface');
  const out={...m,from:[...from],start:time};time+=m.seconds;from=m.to;return out;
 });
 const hold=p.holdSeconds??0;if(!Number.isFinite(hold)||hold<0||time+hold>300)throw Error('Cut preview duration must be at most 300 seconds');
 return {...p,kind:'cut',duration:time+hold,nx,ny,dx:s.size[0]/nx,dy:s.size[1]/ny};
}
export function compileCutMotion(value,scene,revision){
 if(!revision||value?.sourceRevision!==revision)throw Error('Cut preview is stale or missing its CAD source revision');
 const p=validateCutRequest(value),stock=scene.parts.find(v=>v.id===p.stock.id),tool=scene.parts.find(v=>v.id===p.tool.id);
 if(!stock||!tool||p.tool.nozzleId&&!scene.parts.some(v=>v.id===p.tool.nozzleId))throw Error('Cut stock or tool is missing from this scene');
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
 if(A<1e-20)return dx*dx+dy*dy<=(r+1e-9*Math.max(1,r))**2?Math.min(a[2],b[2]):Infinity;
 // Projection avoids cancellation of B²-4AC for a narrow kerf on a long
 // segment. A sub-nanometre pad makes tangent cell classification independent
 // of how the timeline was subdivided into rendered frames.
 const padded=r+1e-9*Math.max(1,r),centre=-(dx*vx+dy*vy)/A;
 const px=dx+centre*vx,py=dy+centre*vy,remaining=padded*padded-px*px-py*py;
 if(remaining<0)return Infinity;
 const half=Math.sqrt(remaining/A),low=Math.max(0,centre-half),high=Math.min(1,centre+half);
 if(low>high)return Infinity;
 return a[2]+(b[2]-a[2])*(b[2]>=a[2]?low:high);
}
export class CutSurfaces {
 constructor(plan,scene){
  this.plan=plan;this.source=scene.parts.find(p=>p.id===plan.stock.id);
  if(plan.tool.kind==='laser'){
   this.beam=scene.parts.find(p=>p.id===plan.tool.id);
   this.beamPositions=new Float32Array(this.beam.positions.length);
   this.beamLow=Infinity;let high=-Infinity;for(let i=2;i<this.beam.positions.length;i+=3){this.beamLow=Math.min(this.beamLow,this.beam.positions[i]);high=Math.max(high,this.beam.positions[i]);}this.beamSpan=high-this.beamLow;
   if(this.beamSpan<=0)throw Error('Laser beam mesh must have nonzero height');
  }
  const count=plan.nx*plan.ny;this.heights=new Float64Array(count);
  this.corners=new Float64Array((plan.nx+1)*(plan.ny+1)*2);
  this.positions=new Float32Array(count*24*3);this.normals=new Float32Array(this.positions.length);const indices=new Uint32Array(count*36);
  for(let i=0;i<count*6;i++){const v=i*4;indices.set([v,v+1,v+2,v,v+2,v+3],i*6);}
  this.mesh={...this.source,positions:this.positions,normals:this.normals,indices};this.last=-1;
  this.evaluate(plan,0);
 }
 renderParts(){return {[this.source.id]:this.mesh};}
 originals(){return {[this.source.id]:this.source,...(this.beam?{[this.beam.id]:this.beam}:{})};}
 resetOpacity(){return this.beam?{[this.beam.id]:0}:{};}
 carve(a,b){
  const p=this.plan,r=p.tool.diameterMm/2,[ox,oy,oz]=p.stock.origin;
  const xmin=Math.max(0,Math.floor((Math.min(a[0],b[0])-r-ox)/p.dx)),xmax=Math.min(p.nx-1,Math.floor((Math.max(a[0],b[0])+r-ox)/p.dx));
  const ymin=Math.max(0,Math.floor((Math.min(a[1],b[1])-r-oy)/p.dy)),ymax=Math.min(p.ny-1,Math.floor((Math.max(a[1],b[1])+r-oy)/p.dy));
  for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++){
   const z=Math.max(oz,toolDepth(ox+(x+.5)*p.dx,oy+(y+.5)*p.dy,a,b,r)),i=y*p.nx+x;
   if(z<this.heights[i]){this.heights[i]=z;this.changed=true;}
  }
 }
 // Surface-net boundary vertices: intersect neighbouring cell centres with the
 // actual swept cutter, then share each vertex between all incident columns.
 // This removes axis-aligned stairs without blurring heights or losing islands.
 contour(segments){
  const p=this.plan,[ox,oy]=p.stock.origin,r=p.tool.diameterMm/2,stride=p.nx+1;
  let local=[];
  const distance=(x,y,depth)=>{
   let best=Infinity;
   for(const [a,b] of local){
    if(Math.min(a[2],b[2])>depth+1e-8)continue;
    const vx=b[0]-a[0],vy=b[1]-a[1],length=vx*vx+vy*vy;
    const t=length?Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/length)):0;
    best=Math.min(best,Math.hypot(x-a[0]-vx*t,y-a[1]-vy*t)-r);
   }
   return best;
  };
  // Depth ramps keep the column representation; contouring applies to planar
  // passes and vertical plunges, where the swept boundary is well-defined.
  const planar=segments.every(([a,b])=>Math.abs(a[2]-b[2])<1e-8||Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8);
  for(let y=0;y<=p.ny;y++)for(let x=0;x<=p.nx;x++){
   const k=(y*stride+x)*2,cx=ox+x*p.dx,cy=oy+y*p.dy;this.corners[k]=cx;this.corners[k+1]=cy;
   if(!planar||!x||!y||x===p.nx||y===p.ny)continue;
   const h=[this.heights[(y-1)*p.nx+x-1],this.heights[(y-1)*p.nx+x],this.heights[y*p.nx+x],this.heights[y*p.nx+x-1]];
   const low=Math.min(...h),high=Math.max(...h);if(high-low<1e-8||h.some(v=>v!==low&&v!==high))continue;
   local=segments.filter(([a,b])=>Math.min(a[2],b[2])<=low+1e-8&&cx+p.dx/2>=Math.min(a[0],b[0])-r&&cx-p.dx/2<=Math.max(a[0],b[0])+r&&cy+p.dy/2>=Math.min(a[1],b[1])-r&&cy-p.dy/2<=Math.max(a[1],b[1])+r);
   const pts=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([a,b])=>[cx+a*p.dx,cy+b*p.dy]);
   const crosses=[];
   for(let i=0;i<4;i++){
    const j=(i+1)%4;if(h[i]===h[j])continue;
    let a=pts[h[i]===low?i:j],b=pts[h[i]===low?j:i];
    // Reject ambiguous/sub-grid cases rather than moving unrelated geometry.
    if(distance(...a,low)>1e-7||distance(...b,low)<-1e-7){crosses.length=0;break;}
    for(let n=0;n<16;n++){const m=[(a[0]+b[0])/2,(a[1]+b[1])/2];if(distance(...m,low)<=0)a=m;else b=m;}
    crosses.push([(a[0]+b[0])/2,(a[1]+b[1])/2]);
   }
   // Four crossings indicate disconnected diagonal regions. Preserve topology.
   if(crosses.length===2){this.corners[k]=(crosses[0][0]+crosses[1][0])/2;this.corners[k+1]=(crosses[0][1]+crosses[1][1])/2;}
  }
 }
 rebuild(segments){
  const p=this.plan,[ox,oy,z0]=p.stock.origin;this.contour(segments);
  const quad=(slot,pts,n)=>{for(let k=0;k<4;k++){this.positions.set(pts[k],slot+k*3);this.normals.set(n,slot+k*3);}};
  for(let y=0;y<p.ny;y++)for(let x=0;x<p.nx;x++){
   const i=y*p.nx+x,s=i*72,z=this.heights[i],x0=ox+x*p.dx,x1=x0+p.dx,y0=oy+y*p.dy,y1=y0+p.dy;
   const top=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([a,b])=>{const k=(b*(p.nx+1)+a)*2;return [this.corners[k],this.corners[k+1],z];});
   // Fully removed cells collapse to a point, leaving no bottom across a kerf.
   if(z<=z0+1e-10){for(let k=0;k<24;k++)this.positions.set([x0,y0,z0],s+k*3);continue;}
   quad(s,top,[0,0,1]);quad(s+12,[...top].reverse().map(v=>[v[0],v[1],z0]),[0,0,-1]);
   const levels=[y?this.heights[i-p.nx]:z0,x<p.nx-1?this.heights[i+1]:z0,y<p.ny-1?this.heights[i+p.nx]:z0,x?this.heights[i-1]:z0];
   for(let k=0;k<4;k++){const a=top[k],b=top[(k+1)%4],bottom=Math.min(z,levels[k]),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)||1;quad(s+24+k*12,[a,[a[0],a[1],bottom],[b[0],b[1],bottom],b],[dy/length,-dx/length,0]);}
  }
 }
 evaluate(plan,time){
  const t=Math.max(0,Math.min(plan.duration,time));this.changed=false;
  if(this.last<0||t<this.last){this.heights.fill(plan.stock.origin[2]+plan.stock.size[2]);this.last=0;this.changed=true;}
  let tip=plan.start,cutting=false;const segments=[];
  for(const m of plan.moves){
   if(t<m.start)break;
   const f=Math.min(1,(t-m.start)/m.seconds);cutting=m.mode==='cut'&&t<m.start+m.seconds;tip=m.from.map((v,k)=>v+(m.to[k]-v)*f);
   if(m.mode==='cut'&&t>m.start)segments.push([m.from,tip]);
   if(m.mode==='cut'&&t>m.start&&this.last<m.start+m.seconds){const start=Math.max(0,(this.last-m.start)/m.seconds),a=m.from.map((v,k)=>v+(m.to[k]-v)*start);this.carve(a,tip);this.changed=true;}
  }
  // The boundary moves continuously even before another cell centre is cut.
  if(this.changed)this.rebuild(segments);this.last=t;
  const transforms=Object.fromEntries(plan.partIds?.map(id=>[id,identityTransform()])??[]),tool=identityTransform();[tool[3],tool[7],tool[11]]=tip;transforms[plan.tool.id]=tool;
  const deformations=this.changed?{[plan.stock.id]:{positions:this.positions,normals:this.normals}}:{};
  if(this.beam){
   const bottom=plan.stock.origin[2]+plan.stock.size[2]-tip[2],top=plan.tool.lengthMm;
   for(let i=0;i<this.beamPositions.length;i+=3){this.beamPositions[i]=this.beam.positions[i];this.beamPositions[i+1]=this.beam.positions[i+1];this.beamPositions[i+2]=bottom+(this.beam.positions[i+2]-this.beamLow)/this.beamSpan*Math.max(0,top-bottom);}
   deformations[plan.tool.id]={positions:this.beamPositions,normals:this.beam.normals};
   if(plan.tool.nozzleId)transforms[plan.tool.nozzleId]=[...tool];
  }
  return {angles:{},transforms,deformations,...(this.beam?{opacity:{[plan.tool.id]:cutting?1:0}}:{})};
 }
}
